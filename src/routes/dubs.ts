import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createDb } from "@/db/client";
import { dubJobs } from "@/db/schema";
import { requireAuth } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import { ApiError } from "@/lib/errors";
import {
  CANCELLABLE_DUB_STATUSES,
  DUB_JOB_STATUSES,
  isAllowedMediaFileName,
  isDubJobStatus,
  isKnownLanguageCode,
  isOwnedUploadPath,
  MAX_UPLOAD_BYTES,
  toDubJobDto,
  uploadObjectKey,
  type DubJobStatus,
} from "@/lib/dubs";
import type { AppEnv } from "@/types/env";

/**
 * Portal cloud dub job API.
 *
 * Routes match portal.trackdub OpenAPI + CreateJobPage / FileDropZone /
 * useJobs expectations. Auth is session-cookie via requireAuth.
 *
 * Honest scaffold: create leaves jobs Queued. No fake Running/Completed and
 * no invented output media — a later pipeline worker owns that.
 */
export const dubs = new Hono<AppEnv>({ strict: false });

dubs.use("*", requireAuth);

const createJobSchema = z
  .object({
    projectName: z.string().trim().min(1).max(128),
    sourceLanguage: z.string().trim().min(2).max(16),
    targetLanguage: z.string().trim().min(2).max(16),
    inputMediaPath: z.string().trim().min(1).max(1024),
  })
  .superRefine((body, ctx) => {
    if (!isKnownLanguageCode(body.sourceLanguage)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceLanguage"],
        message: "Unknown source language code",
      });
    }
    if (!isKnownLanguageCode(body.targetLanguage)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetLanguage"],
        message: "Unknown target language code",
      });
    }
    if (body.sourceLanguage === body.targetLanguage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetLanguage"],
        message: "Source and target language must differ",
      });
    }
  });

const listQuerySchema = z.object({
  status: z.string().optional(),
});

function requireUser(c: { get: (k: "user") => AppEnv["Variables"]["user"] }) {
  const user = c.get("user");
  if (!user) throw ApiError.unauthorized();
  return user;
}

async function loadOwnedJob(db: ReturnType<typeof createDb>, userId: string, jobId: string) {
  const rows = await db
    .select()
    .from(dubJobs)
    .where(and(eq(dubJobs.id, jobId), eq(dubJobs.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw ApiError.notFound("Job not found");
  return row;
}

/**
 * POST /api/dubs/upload — multipart field `file`.
 * Response: `{ filePath }` (portal FileDropZone).
 */
dubs.post("/upload", async (c) => {
  const user = requireUser(c);

  const contentLength = c.req.header("content-length");
  if (contentLength) {
    const n = Number(contentLength);
    if (Number.isFinite(n) && n > MAX_UPLOAD_BYTES) {
      throw ApiError.payloadTooLarge("Upload exceeds the 100 MB Worker limit");
    }
  }

  const body = await c.req.parseBody({ all: true });
  const file = body["file"];
  if (!(file instanceof File)) {
    throw ApiError.badRequest('Expected multipart field "file"');
  }

  if (!isAllowedMediaFileName(file.name)) {
    throw ApiError.unsupportedMediaType("Unsupported media file type");
  }
  if (file.size <= 0) {
    throw ApiError.badRequest("Empty file");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw ApiError.payloadTooLarge("Upload exceeds the 100 MB Worker limit");
  }

  const uploadId = crypto.randomUUID();
  const objectKey = uploadObjectKey(user.id, uploadId, file.name);
  const bytes = await file.arrayBuffer();

  await c.env.MEDIA.put(objectKey, bytes, {
    httpMetadata: {
      contentType: file.type || "application/octet-stream",
    },
    customMetadata: {
      userId: user.id,
      originalFileName: file.name,
      uploadedAt: new Date().toISOString(),
    },
  });

  return c.json(
    {
      filePath: objectKey,
      fileName: file.name,
      fileSize: file.size,
    },
    200,
  );
});

/**
 * GET /api/dubs — list jobs for the session user.
 * Optional `?status=` filter (portal JobStatus string).
 */
dubs.get("/", validate("query", listQuerySchema), async (c) => {
  const user = requireUser(c);
  const { status } = c.get("valid_query");
  const db = createDb(c.env.DB);

  let filterStatus: DubJobStatus | undefined;
  if (status && status !== "All") {
    if (!isDubJobStatus(status)) {
      throw ApiError.badRequest(`Invalid status filter. Expected one of: ${DUB_JOB_STATUSES.join(", ")}`);
    }
    filterStatus = status;
  }

  const where =
    filterStatus === undefined
      ? eq(dubJobs.userId, user.id)
      : and(eq(dubJobs.userId, user.id), eq(dubJobs.status, filterStatus));

  const items = await db
    .select()
    .from(dubJobs)
    .where(where)
    .orderBy(desc(dubJobs.createdAt));

  const countRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(dubJobs)
    .where(where);
  const totalCount = Number(countRow[0]?.count ?? items.length);

  return c.json({
    items: items.map(toDubJobDto),
    totalCount,
  });
});

/**
 * POST /api/dubs — create a Queued job from a prior upload path.
 * Portal CreateJobPage posts JSON and navigates to `/jobs/${jobId}`.
 */
dubs.post("/", validate("json", createJobSchema), async (c) => {
  const user = requireUser(c);
  const body = c.get("valid_json");
  const db = createDb(c.env.DB);

  if (!isOwnedUploadPath(user.id, body.inputMediaPath)) {
    throw ApiError.badRequest("inputMediaPath is not an upload owned by this user");
  }

  const object = await c.env.MEDIA.head(body.inputMediaPath);
  if (!object) {
    throw ApiError.badRequest("inputMediaPath does not exist in media storage");
  }

  const now = new Date();
  const id = crypto.randomUUID();

  await db.insert(dubJobs).values({
    id,
    userId: user.id,
    projectName: body.projectName,
    sourceLanguage: body.sourceLanguage,
    targetLanguage: body.targetLanguage,
    status: "Queued",
    inputMediaPath: body.inputMediaPath,
    outputMediaPath: null,
    progressPercent: 0,
    currentStage: null,
    errorMessage: null,
    durationSeconds: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  });

  const row = await loadOwnedJob(db, user.id, id);
  return c.json(toDubJobDto(row), 201);
});

/**
 * GET /api/dubs/:jobId
 */
dubs.get("/:jobId", async (c) => {
  const user = requireUser(c);
  const jobId = c.req.param("jobId");
  const db = createDb(c.env.DB);
  const row = await loadOwnedJob(db, user.id, jobId);
  return c.json(toDubJobDto(row));
});

/**
 * DELETE /api/dubs/:jobId — cancel Queued or Running.
 */
dubs.delete("/:jobId", async (c) => {
  const user = requireUser(c);
  const jobId = c.req.param("jobId");
  const db = createDb(c.env.DB);
  const row = await loadOwnedJob(db, user.id, jobId);

  if (!(CANCELLABLE_DUB_STATUSES as readonly string[]).includes(row.status)) {
    throw ApiError.badRequest(`Cannot cancel a job in status ${row.status}`);
  }

  const now = new Date();
  const result = await db
    .update(dubJobs)
    .set({
      status: "Cancelled",
      updatedAt: now,
      completedAt: now,
      currentStage: null,
    })
    .where(
      and(
        eq(dubJobs.id, jobId),
        eq(dubJobs.userId, user.id),
        // Atomic check: only update if still in cancellable state
        sql`${dubJobs.status} IN ('Queued', 'Running')`
      )
    );

  // Verify the update succeeded (status was still cancellable)
  const updated = await loadOwnedJob(db, user.id, jobId);
  if (updated.status !== "Cancelled") {
    throw ApiError.badRequest(`Cannot cancel a job in status ${updated.status}`);
  }
  
  return c.json(toDubJobDto(updated));
});

/**
 * GET /api/dubs/:jobId/download — stream completed output from R2.
 * Portal treats 404 as missing output and 409 as not completed.
 */
dubs.get("/:jobId/download", async (c) => {
  const user = requireUser(c);
  const jobId = c.req.param("jobId");
  const db = createDb(c.env.DB);
  const row = await loadOwnedJob(db, user.id, jobId);

  if (row.status !== "Completed") {
    throw ApiError.conflict("Job not completed");
  }
  if (!row.outputMediaPath) {
    throw ApiError.notFound("Download not available");
  }

  const object = await c.env.MEDIA.get(row.outputMediaPath);
  if (!object) {
    throw ApiError.notFound("Download not available");
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  
  // Validate Content-Type to prevent XSS via content type confusion
  const contentType = object.httpMetadata?.contentType || headers.get("content-type") || "";
  const allowedTypes = ["video/mp4", "video/quicktime", "video/x-matroska", "video/x-msvideo", "video/webm"];
  if (!allowedTypes.some(t => contentType.startsWith(t))) {
    throw ApiError.badRequest("Invalid output media type");
  }
  
  const safeName = row.projectName.replace(/[^\w.\- ]+/g, "_").slice(0, 80) || "output";
  headers.set("content-disposition", `attachment; filename="${safeName}.mp4"`);

  return new Response(object.body, { status: 200, headers });
});
