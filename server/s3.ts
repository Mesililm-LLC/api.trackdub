/**
 * S3-backed {@link ObjectStore} for the container runtime. Replaces the R2
 * bucket binding used on Cloudflare. Credentials come from the ECS task role.
 */
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type {
  ObjectContent,
  ObjectHead,
  ObjectPutOptions,
  ObjectStore,
  ObjectValue,
} from "@/platform/objects";

function toBytes(value: ObjectValue): Uint8Array | string {
  if (typeof value === "string") return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function isMissing(err: unknown): boolean {
  if (!(err instanceof S3ServiceException)) return false;
  return err.name === "NotFound" || err.name === "NoSuchKey" || err.$metadata.httpStatusCode === 404;
}

export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, value: ObjectValue, options?: ObjectPutOptions): Promise<void> {
    // S3 user metadata travels as HTTP headers and must be ASCII; encode values
    // so file names with non-ASCII characters survive a round trip.
    const metadata = Object.fromEntries(
      Object.entries(options?.customMetadata ?? {}).map(([k, v]) => [k, encodeURIComponent(v)]),
    );
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: toBytes(value),
        ContentType: options?.httpMetadata?.contentType,
        Metadata: metadata,
      }),
    );
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        size: res.ContentLength ?? 0,
        httpMetadata: res.ContentType ? { contentType: res.ContentType } : undefined,
      };
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async get(key: string): Promise<ObjectContent | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        size: res.ContentLength ?? 0,
        httpMetadata: res.ContentType ? { contentType: res.ContentType } : undefined,
        httpEtag: res.ETag ?? "",
        body: res.Body ? (res.Body.transformToWebStream() as ReadableStream<Uint8Array>) : null,
      };
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }
}

export function createS3ObjectStore(bucket: string, region?: string): S3ObjectStore {
  return new S3ObjectStore(new S3Client({ region }), bucket);
}
