/**
 * Object storage surface used by the dub job routes: write an upload, check
 * that an object exists, and stream one back. Production backs this with S3;
 * tests use an in-memory implementation.
 *
 * The field names (`httpMetadata`, `httpEtag`, `customMetadata`) follow the
 * shape the routes already consumed, so only the type of `MEDIA` changed.
 */

export interface ObjectPutOptions {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

export type ObjectValue = ArrayBuffer | ArrayBufferView | string;

export interface ObjectHead {
  size: number;
  httpMetadata?: { contentType?: string };
}

export interface ObjectContent extends ObjectHead {
  body: ReadableStream<Uint8Array> | null;
  /** Quoted entity tag, ready to use as an HTTP `ETag` header value. */
  httpEtag: string;
}

export interface ObjectStore {
  put(key: string, value: ObjectValue, options?: ObjectPutOptions): Promise<unknown>;
  head(key: string): Promise<ObjectHead | null>;
  get(key: string): Promise<ObjectContent | null>;
}
