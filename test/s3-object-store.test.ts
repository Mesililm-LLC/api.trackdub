import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { S3ObjectStore } from "../server/s3";

type Sent = { command: unknown };

function fakeClient(respond: (command: unknown) => unknown): { client: S3Client; sent: Sent[] } {
  const sent: Sent[] = [];
  const client = {
    send: async (command: unknown) => {
      sent.push({ command });
      return respond(command);
    },
  } as unknown as S3Client;
  return { client, sent };
}

function s3Error(name: string, status: number): S3ServiceException {
  return new S3ServiceException({ name, $fault: "client", $metadata: { httpStatusCode: status }, message: name });
}

describe("S3ObjectStore", () => {
  it("writes bytes with content type and URI-encoded metadata", async () => {
    const { client, sent } = fakeClient(() => ({}));
    const store = new S3ObjectStore(client, "media-bucket");

    await store.put("uploads/u1/a.mp4", new Uint8Array([1, 2, 3]).buffer, {
      httpMetadata: { contentType: "video/mp4" },
      customMetadata: { userId: "u1", originalFileName: "résumé interview.mp4" },
    });

    const command = sent[0]!.command as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "media-bucket",
      Key: "uploads/u1/a.mp4",
      ContentType: "video/mp4",
      Metadata: { userId: "u1", originalFileName: "r%C3%A9sum%C3%A9%20interview.mp4" },
    });
    expect(Array.from(command.input.Body as Uint8Array)).toEqual([1, 2, 3]);
  });

  it("accepts string bodies and typed-array views", async () => {
    const { client, sent } = fakeClient(() => ({}));
    const store = new S3ObjectStore(client, "b");
    await store.put("k1", "<script>alert(1)</script>");
    const view = new Uint8Array([9, 8, 7, 6]).subarray(1, 3);
    await store.put("k2", view);

    expect((sent[0]!.command as PutObjectCommand).input.Body).toBe("<script>alert(1)</script>");
    expect(Array.from((sent[1]!.command as PutObjectCommand).input.Body as Uint8Array)).toEqual([8, 7]);
  });

  it("head returns size and content type, and null when the object is missing", async () => {
    const { client } = fakeClient((command) => {
      if (command instanceof HeadObjectCommand && command.input.Key === "present") {
        return { ContentLength: 42, ContentType: "video/mp4" };
      }
      throw s3Error("NotFound", 404);
    });
    const store = new S3ObjectStore(client, "b");

    expect(await store.head("present")).toEqual({ size: 42, httpMetadata: { contentType: "video/mp4" } });
    expect(await store.head("absent")).toBeNull();
  });

  it("get returns a readable body with the etag, and null for a missing key", async () => {
    const payload = new TextEncoder().encode("hello");
    const { client } = fakeClient((command) => {
      if (command instanceof GetObjectCommand && command.input.Key === "present") {
        return {
          ContentLength: payload.byteLength,
          ContentType: "video/mp4",
          ETag: '"abc123"',
          Body: { transformToWebStream: () => new Blob([payload]).stream() },
        };
      }
      throw s3Error("NoSuchKey", 404);
    });
    const store = new S3ObjectStore(client, "b");

    const found = await store.get("present");
    expect(found).not.toBeNull();
    expect(found!.httpEtag).toBe('"abc123"');
    expect(found!.httpMetadata?.contentType).toBe("video/mp4");
    expect(await new Response(found!.body).text()).toBe("hello");
    expect(await store.get("absent")).toBeNull();
  });

  it("rethrows errors that are not a missing object", async () => {
    const { client } = fakeClient(() => {
      throw s3Error("AccessDenied", 403);
    });
    const store = new S3ObjectStore(client, "b");

    await expect(store.head("k")).rejects.toThrow("AccessDenied");
    await expect(store.get("k")).rejects.toThrow("AccessDenied");
  });
});
