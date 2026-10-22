import type {
  ObjectContent,
  ObjectHead,
  ObjectPutOptions,
  ObjectStore,
  ObjectValue,
} from "@/platform/objects";

interface Stored {
  bytes: Uint8Array;
  contentType: string | undefined;
  etag: string;
}

function toBytes(value: ObjectValue): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
}

/** In-memory {@link ObjectStore} for tests. */
export class MemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, Stored>();
  private counter = 0;

  async put(key: string, value: ObjectValue, options?: ObjectPutOptions): Promise<void> {
    this.counter += 1;
    this.objects.set(key, {
      bytes: toBytes(value),
      contentType: options?.httpMetadata?.contentType,
      etag: `"etag-${this.counter}"`,
    });
  }

  async head(key: string): Promise<ObjectHead | null> {
    const stored = this.objects.get(key);
    if (!stored) return null;
    return { size: stored.bytes.byteLength, httpMetadata: { contentType: stored.contentType } };
  }

  async get(key: string): Promise<ObjectContent | null> {
    const stored = this.objects.get(key);
    if (!stored) return null;
    const bytes = stored.bytes;
    return {
      size: bytes.byteLength,
      httpMetadata: { contentType: stored.contentType },
      httpEtag: stored.etag,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    };
  }
}
