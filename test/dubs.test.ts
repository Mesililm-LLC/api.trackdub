import { env } from "./support/portal-env";
import { describe, it, expect, beforeAll } from "vitest";
import app from "@/index";
import { createAuth } from "@/auth";
import { provisionUser } from "@/auth/provision";
import { createDb } from "@/db/client";
import { dubJobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { Bindings } from "@/types/env";

const bindings = {
  ...(env as unknown as Bindings),
  DUB_PROCESSOR_ENABLED: "true",
};

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

async function sessionUserId(cookie: string): Promise<string> {
  const res = await app.request(
    "/api/auth/session",
    { headers: { Cookie: cookie } },
    bindings,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { user?: { id?: string } } | null;
  expect(body?.user?.id).toBeTruthy();
  return body!.user!.id!;
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
  it("rejects job intake when no processor is available", async () => {
    const cookie = await signIn(USER.email, USER.password);
    const unavailable = { ...bindings, DUB_PROCESSOR_ENABLED: "false" };
    const create = await app.request(
      "/api/dubs/",
      {
        method: "POST",
        headers: { ...jsonHeaders, Cookie: cookie },
        body: JSON.stringify({
          projectName: "Never Queued",
          sourceLanguage: "en",
          targetLanguage: "es",
          inputMediaPath: "uploads/unused/path.wav",
        }),
      },
      unavailable,
    );
    expect(create.status).toBe(503);
    expect(await create.json()).toMatchObject({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: expect.stringMatching(/processing is not available/i),
      },
    });
  });

  it("rejects uploads when no processor is available", async () => {
    const cookie = await signIn(USER.email, USER.password);
    const unavailable = { ...bindings, DUB_PROCESSOR_ENABLED: "false" };
    const form = new FormData();
    form.append("file", tinyWavFile());
    const upload = await app.request(
      "/api/dubs/upload",
      { method: "POST", headers: { Cookie: cookie, Origin: PORTAL }, body: form },
      unavailable,
    );
    expect(upload.status).toBe(503);
    expect(await upload.json()).toMatchObject({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: expect.stringMatching(/media was not uploaded/i),
      },
    });
  });

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

  it("keeps management and completed downloads available when processing is disabled", async () => {
    const cookie = await signIn(USER.email, USER.password);
    const filePath = await uploadMedia(cookie);
    const create = await app.request(
      "/api/dubs",
      {
        method: "POST",
        headers: { ...jsonHeaders, Cookie: cookie },
        body: JSON.stringify({
          projectName: "Managed Without Processor",
          sourceLanguage: "en",
          targetLanguage: "es",
          inputMediaPath: filePath,
        }),
      },
    bindings,
    );
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string };
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

    const unavailable = { ...bindings, DUB_PROCESSOR_ENABLED: "false" };
    const list = await app.request("/api/dubs", { headers: { Cookie: cookie } }, unavailable);
    expect(list.status).toBe(200);
    expect(((await list.json()) as { items: { id: string }[] }).items.some((job) => job.id === created.id)).toBe(true);

    const detail = await app.request(`/api/dubs/${created.id}`, { headers: { Cookie: cookie } }, unavailable);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id: created.id, status: "Completed" });

    const queuedCreate = await app.request(
      "/api/dubs",
      {
        method: "POST",
        headers: { ...jsonHeaders, Cookie: cookie },
        body: JSON.stringify({
          projectName: "Cancel Without Processor",
          sourceLanguage: "en",
          targetLanguage: "fr",
          inputMediaPath: filePath,
        }),
      },
    bindings,
    );
    expect(queuedCreate.status).toBe(201);
    const queuedJob = (await queuedCreate.json()) as { id: string };

    const cancel = await app.request(
      `/api/dubs/${queuedJob.id}`,
      { method: "DELETE", headers: { Cookie: cookie, Origin: PORTAL } },
      unavailable,
    );
    expect(cancel.status).toBe(200);
    expect(await cancel.json()).toMatchObject({ id: queuedJob.id, status: "Cancelled" });

    const download = await app.request(
      `/api/dubs/${created.id}/download`,
      { headers: { Cookie: cookie } },
      unavailable,
    );
    expect(download.status).toBe(200);

    const healthRes = await app.request("/api/health", {}, unavailable);
    expect(healthRes.status).toBe(200);
    const healthBody = (await healthRes.json()) as { availablePipelines: string[] };
    expect(healthBody.availablePipelines).toContain("dub-management");
    expect(healthBody.availablePipelines).not.toContain("dub-processing");
  });

  it("rejects create when inputMediaPath is missing from R2 or owned by another user", async () => {
    const cookie = await signIn(USER.email, USER.password);
    const userId = await sessionUserId(cookie);
    const otherCookie = await signIn(OTHER.email, OTHER.password);
    const otherPath = await uploadMedia(otherCookie);

    // Owned prefix but object absent from R2 → MEDIA.head miss branch.
    const missing = await app.request(
      "/api/dubs",
      {
        method: "POST",
        headers: { ...jsonHeaders, Cookie: cookie },
        body: JSON.stringify({
          projectName: "Missing",
          sourceLanguage: "en",
          targetLanguage: "fr",
          inputMediaPath: `uploads/${userId}/${crypto.randomUUID()}/nope.wav`,
        }),
      },
    bindings,
    );
    expect(missing.status).toBe(400);
    const missingBody = (await missing.json()) as { error: { message: string } };
    expect(missingBody.error.message).toMatch(/does not exist in media storage/i);

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
    const stolenBody = (await stolen.json()) as { error: { message: string } };
    expect(stolenBody.error.message).toMatch(/not an upload owned by this user/i);
  });

  it("returns 400 for a malformed multipart upload body", async () => {
    const cookie = await signIn(USER.email, USER.password);
    const res = await app.request(
      "/api/dubs/upload",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: PORTAL,
          "Content-Type": "multipart/form-data; boundary=----broken",
        },
        // Truncated multipart: boundary declared but body is garbage.
        body: "this-is-not-valid-multipart",
      },
      bindings,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message.toLowerCase()).toMatch(/multipart|file/);
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
    expect(download.headers.get("content-type")).toBe("video/mp4");
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("names downloads with an extension matching the validated Content-Type", async () => {
    const cookie = await signIn(USER.email, USER.password);
    const filePath = await uploadMedia(cookie);

    const create = await app.request(
      "/api/dubs",
      {
        method: "POST",
        headers: { ...jsonHeaders, Cookie: cookie },
        body: JSON.stringify({
          projectName: "WebmOut",
          sourceLanguage: "en",
          targetLanguage: "es",
          inputMediaPath: filePath,
        }),
      },
    bindings,
    );
    const created = (await create.json()) as { id: string };
    const outputKey = `outputs/${created.id}/dubbed.webm`;
    await bindings.MEDIA.put(outputKey, new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]), {
      httpMetadata: { contentType: "video/webm" },
    });
    const db = createDb(bindings.DB);
    await db
      .update(dubJobs)
      .set({
        status: "Completed",
        outputMediaPath: outputKey,
        progressPercent: 100,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(dubJobs.id, created.id));

    const download = await app.request(
      `/api/dubs/${created.id}/download`,
      { headers: { Cookie: cookie } },
    bindings,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("video/webm");
    expect(download.headers.get("content-disposition")).toMatch(/WebmOut\.webm/);
  });

  it("rejects cancel after the job leaves a cancellable status (atomic WHERE)", async () => {
    const cookie = await signIn(USER.email, USER.password);
    const filePath = await uploadMedia(cookie);

    const create = await app.request(
      "/api/dubs",
      {
        method: "POST",
        headers: { ...jsonHeaders, Cookie: cookie },
        body: JSON.stringify({
          projectName: "Race",
          sourceLanguage: "en",
          targetLanguage: "es",
          inputMediaPath: filePath,
        }),
      },
      bindings,
    );
    const created = (await create.json()) as { id: string };

    // Simulate a worker finishing between our ownership load and cancel UPDATE.
    const db = createDb(bindings.DB);
    await db
      .update(dubJobs)
      .set({
        status: "Completed",
        progressPercent: 100,
        completedAt: new Date(),
        updatedAt: new Date(),
        outputMediaPath: `outputs/${created.id}/dubbed.mp4`,
      })
      .where(eq(dubJobs.id, created.id));

    const cancel = await app.request(
      `/api/dubs/${created.id}`,
      { method: "DELETE", headers: { Cookie: cookie, Origin: PORTAL } },
    bindings,
    );
    expect(cancel.status).toBe(400);
    const body = (await cancel.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/Cannot cancel a job in status Completed/);

    const detail = await app.request(
      `/api/dubs/${created.id}`,
      { headers: { Cookie: cookie } },
    bindings,
    );
    const detailBody = (await detail.json()) as { status: string };
    expect(detailBody.status).toBe("Completed");
  });

  it("refuses download when stored Content-Type is not a safe media type", async () => {
    const cookie = await signIn(USER.email, USER.password);
    const filePath = await uploadMedia(cookie);

    const create = await app.request(
      "/api/dubs",
      {
        method: "POST",
        headers: { ...jsonHeaders, Cookie: cookie },
        body: JSON.stringify({
          projectName: "HtmlTrap",
          sourceLanguage: "en",
          targetLanguage: "fr",
          inputMediaPath: filePath,
        }),
      },
    bindings,
    );
    const created = (await create.json()) as { id: string };

    const outputKey = `outputs/${created.id}/dubbed.mp4`;
    await bindings.MEDIA.put(outputKey, "<script>alert(1)</script>", {
      httpMetadata: { contentType: "text/html" },
    });
    const db = createDb(bindings.DB);
    await db
      .update(dubJobs)
      .set({
        status: "Completed",
        outputMediaPath: outputKey,
        progressPercent: 100,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(dubJobs.id, created.id));

    const download = await app.request(
      `/api/dubs/${created.id}/download`,
      { headers: { Cookie: cookie } },
    bindings,
    );
    expect(download.status).toBe(415);
  });

  it("rejects create when inputMediaPath uses encoded path traversal", async () => {
    const cookie = await signIn(USER.email, USER.password);
    const res = await app.request(
      "/api/dubs",
      {
        method: "POST",
        headers: { ...jsonHeaders, Cookie: cookie },
        body: JSON.stringify({
          projectName: "Traversal",
          sourceLanguage: "en",
          targetLanguage: "es",
          inputMediaPath: `uploads/%2e%2e/etc/passwd`,
        }),
      },
    bindings,
    );
    expect(res.status).toBe(400);
  });
});

describe("health advertises dubs scaffold", () => {
  it("reports management and processing capabilities separately", async () => {
    const res = await app.request("/api/health", {}, bindings);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      availablePipelines: string[];
      capabilities: Record<string, boolean>;
    };
    expect(body.availablePipelines).toContain("auth");
    expect(body.availablePipelines).toContain("dub-management");
    expect(body.availablePipelines).toContain("dub-processing");
    expect(body.capabilities).toEqual({
      jobIntake: true,
      upload: true,
      jobProcessing: true,
      outputDownload: true,
    });
  });

  it("does not accept a trailing slash on health (root stays strict)", async () => {
    const res = await app.request("/api/health/live/", {}, bindings);
    expect(res.status).toBe(404);
  });
});
