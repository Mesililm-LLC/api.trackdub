import { env } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import app from "@/index";
import { createAuth } from "@/auth";
import { provisionUser } from "@/auth/provision";
import { createDb } from "@/db/client";
import { dubJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { Bindings } from "@/types/env";

const bindings = env as unknown as Bindings;

const USER = {
  email: "dubs-user@example.com",
  name: "Dubs User",
  password: "correct-horse-battery-staple",
};

const OTHER = {
  email: "dubs-other@example.com",
  name: "Other User",
  password: "correct-horse-battery-staple",
};

const PORTAL = "https://portal.trackdub.com";
const jsonHeaders = { "Content-Type": "application/json", Origin: PORTAL };

beforeAll(async () => {
  const auth = createAuth(bindings);
  await provisionUser(auth, {
    email: USER.email,
    name: USER.name,
    tempPassword: USER.password,
  });
  await provisionUser(auth, {
    email: OTHER.email,
    name: OTHER.name,
    tempPassword: OTHER.password,
  });
});

function sessionCookieFrom(res: Response): string | null {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  const match = /(better-auth\.session_token=[^;]+)/.exec(setCookie);
  return match ? match[1]! : null;
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await app.request(
    "/api/auth/sign-in/email",
    {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ email, password }),
    },
    bindings,
  );
  expect(res.status).toBe(200);
  const cookie = sessionCookieFrom(res);
  expect(cookie).toBeTruthy();
  return cookie!;
}

function tinyWavFile(name = "clip.wav"): File {
  // Minimal RIFF/WAVE header + silence payload — extension validated, content not.
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  view.setUint32(4, 36, true);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
  return new File([bytes], name, { type: "audio/wav" });
}

async function uploadMedia(cookie: string, file = tinyWavFile()): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await app.request(
    "/api/dubs/upload",
    {
      method: "POST",
      headers: { Cookie: cookie, Origin: PORTAL },
      body: form,
    },
    bindings,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { filePath: string };
  expect(body.filePath).toMatch(/^uploads\//);
  return body.filePath;
}

describe("/api/dubs auth gate", () => {
  it("rejects unauthenticated upload/list/create with 401", async () => {
    const upload = await app.request(
      "/api/dubs/upload",
      { method: "POST", headers: { Origin: PORTAL }, body: new FormData() },
      bindings,
    );
    expect(upload.status).toBe(401);

    const list = await app.request("/api/dubs", {}, bindings);
    expect(list.status).toBe(401);

    const create = await app.request(
      "/api/dubs/",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          projectName: "x",
          sourceLanguage: "en",
          targetLanguage: "es",
          inputMediaPath: "uploads/x/y/z.wav",
        }),
      },
      bindings,
    );
    expect(create.status).toBe(401);
  });
});

describe("/api/dubs upload + create + list + cancel", () => {
  it("uploads media, creates a Queued job (trailing slash), lists, and cancels", async () => {
    const cookie = await signIn(USER.email, USER.password);
    const filePath = await uploadMedia(cookie);

    // Portal CreateJobPage posts to `/api/dubs/` with a trailing slash.
    const create = await app.request(
      "/api/dubs/",
      {
        method: "POST",
        headers: { ...jsonHeaders, Cookie: cookie },
        body: JSON.stringify({
          projectName: "Demo Job",
          sourceLanguage: "en",
          targetLanguage: "es",
          inputMediaPath: filePath,
        }),
      },
      bindings,
    );
    expect(create.status).toBe(201);
    const created = (await create.json()) as {
      id: string;
      jobId: string;
      status: string;
      projectName: string;
      progressPercent: number;
      currentStage: string | null;
      durationSeconds: number | null;
    };
    expect(created.id).toBeTruthy();
    expect(created.jobId).toBe(created.id);
    expect(created.status).toBe("Queued");
    expect(created.projectName).toBe("Demo Job");
    expect(created.progressPercent).toBe(0);
    expect(created.currentStage).toBeNull();
    expect(created.durationSeconds).toBeNull();

    const list = await app.request(
      "/api/dubs?status=Queued",
      { headers: { Cookie: cookie } },
      bindings,
    );
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { items: { id: string }[]; totalCount: number };
    expect(listed.totalCount).toBeGreaterThanOrEqual(1);
    expect(listed.items.some((j) => j.id === created.id)).toBe(true);

    const detail = await app.request(
      `/api/dubs/${created.id}`,
      { headers: { Cookie: cookie } },
      bindings,
    );
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as { id: string; status: string };
    expect(detailBody.id).toBe(created.id);
    expect(detailBody.status).toBe("Queued");

    // Honest scaffold: download is not ready while Queued.
    const download = await app.request(
      `/api/dubs/${created.id}/download`,
      { headers: { Cookie: cookie } },
      bindings,
    );
    expect(download.status).toBe(409);

    const cancel = await app.request(
      `/api/dubs/${created.id}`,
      { method: "DELETE", headers: { Cookie: cookie, Origin: PORTAL } },
      bindings,
    );
    expect(cancel.status).toBe(200);
    const cancelled = (await cancel.json()) as { status: string };
    expect(cancelled.status).toBe("Cancelled");
  });

  it("rejects create when inputMediaPath is missing from R2 or owned by another user", async () => {
    const cookie = await signIn(USER.email, USER.password);
    const otherCookie = await signIn(OTHER.email, OTHER.password);
    const otherPath = await uploadMedia(otherCookie);

    const missing = await app.request(
      "/api/dubs",
      {
        method: "POST",
        headers: { ...jsonHeaders, Cookie: cookie },
        body: JSON.stringify({
          projectName: "Missing",
          sourceLanguage: "en",
          targetLanguage: "fr",
          inputMediaPath: `uploads/${crypto.randomUUID()}/nope.wav`,
        }),
      },
      bindings,
    );
    expect(missing.status).toBe(400);

    const stolen = await app.request(
      "/api/dubs",
      {
        method: "POST",
        headers: { ...jsonHeaders, Cookie: cookie },
        body: JSON.stringify({
          projectName: "Stolen",
          sourceLanguage: "en",
          targetLanguage: "fr",
          inputMediaPath: otherPath,
        }),
      },
      bindings,
    );
    expect(stolen.status).toBe(400);
  });

  it("rejects unsupported upload types with 415", async () => {
    const cookie = await signIn(USER.email, USER.password);
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "notes.txt", { type: "text/plain" }));
    const res = await app.request(
      "/api/dubs/upload",
      {
        method: "POST",
        headers: { Cookie: cookie, Origin: PORTAL },
        body: form,
      },
      bindings,
    );
    expect(res.status).toBe(415);
  });

  it("does not leak another user's job by id", async () => {
    const cookie = await signIn(USER.email, USER.password);
    const otherCookie = await signIn(OTHER.email, OTHER.password);
    const filePath = await uploadMedia(cookie);

    const create = await app.request(
      "/api/dubs",
      {
        method: "POST",
        headers: { ...jsonHeaders, Cookie: cookie },
        body: JSON.stringify({
          projectName: "Private",
          sourceLanguage: "en",
          targetLanguage: "de",
          inputMediaPath: filePath,
        }),
      },
      bindings,
    );
    const created = (await create.json()) as { id: string };

    const peek = await app.request(
      `/api/dubs/${created.id}`,
      { headers: { Cookie: otherCookie } },
      bindings,
    );
    expect(peek.status).toBe(404);
  });

  it("serves download when a job is honestly Completed with R2 output", async () => {
    const cookie = await signIn(USER.email, USER.password);
    const filePath = await uploadMedia(cookie);

    const create = await app.request(
      "/api/dubs",
      {
        method: "POST",
        headers: { ...jsonHeaders, Cookie: cookie },
        body: JSON.stringify({
          projectName: "Ready",
          sourceLanguage: "en",
          targetLanguage: "it",
          inputMediaPath: filePath,
        }),
      },
      bindings,
    );
    const created = (await create.json()) as { id: string };

    // Simulate a future pipeline worker writing output + marking Completed.
    // Scaffold routes never do this themselves.
    const outputKey = `outputs/${created.id}/dubbed.mp4`;
    await bindings.MEDIA.put(outputKey, new Uint8Array([0, 0, 0, 1, 0x67]), {
      httpMetadata: { contentType: "video/mp4" },
    });
    const db = createDb(bindings.DB);
    const now = new Date();
    await db
      .update(dubJobs)
      .set({
        status: "Completed",
        outputMediaPath: outputKey,
        progressPercent: 100,
        currentStage: "export",
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(dubJobs.id, created.id));

    const download = await app.request(
      `/api/dubs/${created.id}/download`,
      { headers: { Cookie: cookie } },
      bindings,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toMatch(/Ready\.mp4/);
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });
});

describe("health advertises dubs scaffold", () => {
  it("lists dubs in availablePipelines", async () => {
    const res = await app.request("/api/health", {}, bindings);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { availablePipelines: string[] };
    expect(body.availablePipelines).toContain("auth");
    expect(body.availablePipelines).toContain("dubs");
  });
});
