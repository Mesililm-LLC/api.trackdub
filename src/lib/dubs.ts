import { LANGUAGES } from "@/lib/languages";

/** Portal `JobStatus` string values. Keep in sync with portal.trackdub useJobs. */
export const DUB_JOB_STATUSES = [
  "Queued",
  "Running",
  "Completed",
  "Failed",
  "Cancelled",
] as const;

export type DubJobStatus = (typeof DUB_JOB_STATUSES)[number];

export const TERMINAL_DUB_STATUSES: readonly DubJobStatus[] = [
  "Completed",
  "Failed",
  "Cancelled",
];

export const CANCELLABLE_DUB_STATUSES: readonly DubJobStatus[] = ["Queued", "Running"];

/** Match portal FileDropZone allowed extensions. */
export const ALLOWED_MEDIA_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".mov",
  ".avi",
  ".webm",
  ".mp3",
  ".wav",
  ".flac",
  ".ogg",
]);

/**
 * Worker request-body limit for direct multipart upload. Portal UI advertises
 * 5 GB; true multi-GB needs R2 multipart / direct-to-R2 later. Scaffold is
 * honest about the Worker bound.
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const LANGUAGE_CODES = new Set(LANGUAGES.map((l) => l.code));

export function isKnownLanguageCode(code: string): boolean {
  return LANGUAGE_CODES.has(code);
}

export function isDubJobStatus(value: string): value is DubJobStatus {
  return (DUB_JOB_STATUSES as readonly string[]).includes(value);
}

export function mediaExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx < 0) return "";
  return fileName.slice(idx).toLowerCase();
}

export function isAllowedMediaFileName(fileName: string): boolean {
  return ALLOWED_MEDIA_EXTENSIONS.has(mediaExtension(fileName));
}

/** Strip path separators and control chars from an uploaded file name. */
export function sanitizeFileName(fileName: string): string {
  const base = fileName.replace(/[/\\]/g, "_").replace(/[^\w.\- ()[\]]+/g, "_").trim();
  if (!base || base === "." || base === "..") return "upload.bin";
  return base.slice(0, 200);
}

export function uploadObjectKey(userId: string, uploadId: string, fileName: string): string {
  return `uploads/${userId}/${uploadId}/${sanitizeFileName(fileName)}`;
}

/** True when the R2 key is under this user's upload prefix (path-traversal safe). */
export function isOwnedUploadPath(userId: string, objectKey: string): boolean {
  const prefix = `uploads/${userId}/`;
  if (!objectKey.startsWith(prefix)) return false;
  
  // Normalize path to catch encoded traversal attempts
  const normalized = objectKey.replace(/%2e/gi, '.').replace(/%2f/gi, '/');
  if (normalized.includes("..") || normalized.includes("./")) return false;
  
  // Ensure no path segments are empty and key doesn't escape prefix
  const afterPrefix = objectKey.slice(prefix.length);
  if (!afterPrefix || afterPrefix.includes("//")) return false;
  
  return true;
}
}

export interface DubJobRow {
  id: string;
  projectName: string;
  sourceLanguage: string;
  targetLanguage: string;
  status: string;
  inputMediaPath: string;
  outputMediaPath: string | null;
  progressPercent: number;
  currentStage: string | null;
  errorMessage: string | null;
  durationSeconds: number | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

/** CamelCase DTO matching portal `DubJobApiDto` / CreateJobPage expectations. */
export function toDubJobDto(row: DubJobRow) {
  return {
    id: row.id,
    jobId: row.id,
    projectName: row.projectName,
    sourceLanguage: row.sourceLanguage,
    targetLanguage: row.targetLanguage,
    status: row.status,
    inputMediaPath: row.inputMediaPath,
    outputMediaPath: row.outputMediaPath,
    progressPercent: row.progressPercent,
    currentStage: row.currentStage,
    errorMessage: row.errorMessage,
    durationSeconds: row.durationSeconds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}
