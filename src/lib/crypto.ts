/**
 * Constant-time string comparison to avoid leaking secret length/prefix via
 * timing. Returns false immediately only on length mismatch (unavoidable), and
 * otherwise XORs every byte so comparison time is independent of content.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= (ab[i] as number) ^ (bb[i] as number);
  }
  return diff === 0;
}
