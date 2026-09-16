import { describe, it, expect } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  contentLengthExceedsUploadLimit,
  isOwnedUploadPath,
  isSafeDownloadContentType,
  uploadObjectKey,
} from "@/lib/dubs";

describe("isOwnedUploadPath", () => {
  const userId = "user-abc";

  it("accepts minted upload keys for the owner", () => {
    const key = uploadObjectKey(userId, "upload-1", "clip.wav");
    expect(isOwnedUploadPath(userId, key)).toBe(true);
  });

  it("rejects another user's prefix", () => {
    expect(isOwnedUploadPath(userId, "uploads/other/upload-1/clip.wav")).toBe(false);
  });

  it("rejects plain .. traversal", () => {
    expect(isOwnedUploadPath(userId, `uploads/${userId}/../secrets/key`)).toBe(false);
    expect(isOwnedUploadPath(userId, `uploads/${userId}/a/../../etc/passwd`)).toBe(false);
  });

  it("rejects URL-encoded .. and / bypasses", () => {
    expect(isOwnedUploadPath(userId, `uploads/${userId}/%2e%2e/secrets`)).toBe(false);
    expect(isOwnedUploadPath(userId, `uploads/${userId}/%2E%2E/%2e%2e/x`)).toBe(false);
    expect(isOwnedUploadPath(userId, `uploads/${userId}/a%2fb%2f..%2f..%2fetc/passwd`)).toBe(false);
    expect(isOwnedUploadPath(userId, `uploads%2f${userId}%2fok%2fclip.wav`)).toBe(false);
  });

  it("rejects double-encoded traversal", () => {
    // %252e%252e → %2e%2e → ..
    expect(isOwnedUploadPath(userId, `uploads/${userId}/%252e%252e/x`)).toBe(false);
  });

  it("rejects backslashes, empty segments, and absolute keys", () => {
    expect(isOwnedUploadPath(userId, `uploads/${userId}/a\\..\\b`)).toBe(false);
    expect(isOwnedUploadPath(userId, `uploads/${userId}//clip.wav`)).toBe(false);
    expect(isOwnedUploadPath(userId, `/uploads/${userId}/a/clip.wav`)).toBe(false);
    expect(isOwnedUploadPath(userId, `uploads/${userId}/only-one-segment`)).toBe(false);
  });
});

describe("contentLengthExceedsUploadLimit", () => {
  it("rejects Content-Length above MAX_UPLOAD_BYTES with no framing slack", () => {
    expect(contentLengthExceedsUploadLimit(String(MAX_UPLOAD_BYTES))).toBe(false);
    expect(contentLengthExceedsUploadLimit(String(MAX_UPLOAD_BYTES + 1))).toBe(true);
    expect(contentLengthExceedsUploadLimit(String(MAX_UPLOAD_BYTES + 1024 * 1024))).toBe(true);
  });

  it("ignores missing or non-numeric headers", () => {
    expect(contentLengthExceedsUploadLimit(undefined)).toBe(false);
    expect(contentLengthExceedsUploadLimit("")).toBe(false);
    expect(contentLengthExceedsUploadLimit("nope")).toBe(false);
  });
});

describe("isSafeDownloadContentType", () => {
  it("allowlists media types and rejects html/js", () => {
    expect(isSafeDownloadContentType("video/mp4")).toBe(true);
    expect(isSafeDownloadContentType("video/mp4; charset=utf-8")).toBe(true);
    expect(isSafeDownloadContentType("application/octet-stream")).toBe(true);
    expect(isSafeDownloadContentType("text/html")).toBe(false);
    expect(isSafeDownloadContentType("text/html; charset=utf-8")).toBe(false);
    expect(isSafeDownloadContentType("application/javascript")).toBe(false);
    expect(isSafeDownloadContentType(null)).toBe(false);
    expect(isSafeDownloadContentType(undefined)).toBe(false);
  });
});
