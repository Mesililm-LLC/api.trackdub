import { describe, it, expect } from "vitest";
import app from "@/activation/index";
import { TEST_SIGNING_PUBLIC_KEY_PEM } from "./test-keys";
import { bindings, seedLicense, fingerprint } from "./helpers";

/**
 * Base64url -> bytes, restoring `=` padding to a multiple of 4 first. Used
 * for every base64url segment decoded in this file (JWT header, payload,
 * signature) — pad length must never be assumed from a specific value's
 * length, since it depends on the encoded content (e.g. a longer/shorter
 * `kid` shifts the header's length and thus its required padding).
 */
function base64urlToBytes(segment: string): Uint8Array {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64urlToJson(segment: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64urlToBytes(segment)));
}

/** Decode a JWT payload without verifying — used to inspect claims in tests. */
function decodePayload(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  return base64urlToJson(payload as string);
}

/** SPKI PEM bodies are standard (non-url) base64, already correctly padded. */
async function importTestPublicKey(): Promise<CryptoKey> {
  const body = TEST_SIGNING_PUBLIC_KEY_PEM.replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return crypto.subtle.importKey(
    "spki",
    bytes.buffer as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

async function verifyToken(token: string): Promise<boolean> {
  const [header, payload, signature] = token.split(".");
  const key = await importTestPublicKey();
  const sigBytes = base64urlToBytes(signature as string);
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    sigBytes.buffer as ArrayBuffer,
    new TextEncoder().encode(`${header}.${payload}`),
  );
}

describe("POST /activate", () => {
  it("registers a fingerprint and returns a token that verifies, with kid/iss/aud set", async () => {
    const { licenseKey } = await seedLicense();
    const fp = await fingerprint("machine-1");

    const res = await app.request(
      "/activate",
      { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: fp }) },
      bindings,
    );

    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(await verifyToken(token)).toBe(true);

    const claims = decodePayload(token);
    // The desktop's LicenseTokenParser reads `kid` from the PAYLOAD, not the
    // JWT header — this is the exact bug the legacy reference service had
    // (it never emitted `kid` at all, so no token it minted would ever have
    // verified under DesktopLicenseSignatureTrustStore). Assert both.
    expect(claims.kid).toBe("test-key-2026");
    expect(claims.iss).toBe("https://activate.trackdub.com");
    expect(claims.aud).toBe("trackdub-license-prod");
    expect(claims.exp).toBeNull();
    expect(claims.machines).toEqual([`sha256:${fp}`]);

    const [headerB64] = token.split(".");
    const header = base64urlToJson(headerB64 as string);
    expect(header.kid).toBe("test-key-2026");
  });

  it("is idempotent for an already-active fingerprint", async () => {
    const { licenseKey } = await seedLicense();
    const fp = await fingerprint("machine-idempotent");
    const body = JSON.stringify({ key: licenseKey, fingerprint: fp });

    const first = await app.request("/activate", { method: "POST", body }, bindings);
    const second = await app.request("/activate", { method: "POST", body }, bindings);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const claims = decodePayload(((await second.json()) as { token: string }).token);
    expect(claims.machines).toEqual([`sha256:${fp}`]);
  });

  it("allows a second machine within max_machines", async () => {
    const { licenseKey } = await seedLicense({ maxMachines: 2 });
    const fp1 = await fingerprint("machine-a");
    const fp2 = await fingerprint("machine-b");

    await app.request("/activate", { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: fp1 }) }, bindings);
    const res = await app.request(
      "/activate",
      { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: fp2 }) },
      bindings,
    );

    expect(res.status).toBe(200);
    const claims = decodePayload(((await res.json()) as { token: string }).token);
    expect((claims.machines as string[]).sort()).toEqual([`sha256:${fp1}`, `sha256:${fp2}`].sort());
  });

  it("rejects a third machine with 409 max_activations", async () => {
    const { licenseKey } = await seedLicense({ maxMachines: 2 });
    const fp1 = await fingerprint("machine-c1");
    const fp2 = await fingerprint("machine-c2");
    const fp3 = await fingerprint("machine-c3");

    await app.request("/activate", { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: fp1 }) }, bindings);
    await app.request("/activate", { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: fp2 }) }, bindings);
    const res = await app.request(
      "/activate",
      { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: fp3 }) },
      bindings,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "max_activations", max: 2 });
  });

  it("rejects a revoked license with 403 key_revoked", async () => {
    const { licenseKey } = await seedLicense({ status: "revoked" });
    const fp = await fingerprint("machine-revoked");

    const res = await app.request(
      "/activate",
      { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: fp }) },
      bindings,
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "key_revoked" });
  });

  it("rejects an unknown key with 400 invalid_key", async () => {
    const res = await app.request(
      "/activate",
      { method: "POST", body: JSON.stringify({ key: "TDUB-NOPE-NOPE-NOPE-NOPE", fingerprint: await fingerprint("x") }) },
      bindings,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_key" });
  });

  it("rejects a malformed fingerprint with 400 invalid_fingerprint", async () => {
    const { licenseKey } = await seedLicense();

    const res = await app.request(
      "/activate",
      { method: "POST", body: JSON.stringify({ key: licenseKey, fingerprint: "not-hex" }) },
      bindings,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_fingerprint" });
  });

  it("rejects a missing key with 400 invalid_key", async () => {
    const res = await app.request(
      "/activate",
      { method: "POST", body: JSON.stringify({ fingerprint: await fingerprint("no-key") }) },
      bindings,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_key" });
  });

  it("rejects an oversized key with 400 invalid_key before hashing it", async () => {
    // Bounds the SHA-256 work lookupLicenseByKey does on every request — real
    // keys are 24 chars, this is 129 to just clear the 128-char cap.
    const oversizedKey = "T".repeat(129);

    const res = await app.request(
      "/activate",
      { method: "POST", body: JSON.stringify({ key: oversizedKey, fingerprint: await fingerprint("oversized") }) },
      bindings,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_key" });
  });
});
