import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import app from "@/index";
import { LANGUAGES } from "@/lib/languages";
import type { Bindings } from "@/types/env";

const bindings = env as unknown as Bindings;

describe("language catalog", () => {
  it("serves Chinese alongside the Chatterbox multilingual set", async () => {
    const res = await app.request("/api/languages", {}, bindings);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { code: string; name: string }[] };
    expect(body.items).toContainEqual({ code: "zh", name: "Chinese" });
    expect(body.items).toContainEqual({ code: "es", name: "Spanish" });
  });

  it("lists 23 unique languages", () => {
    const codes = LANGUAGES.map((language) => language.code);
    expect(codes).toHaveLength(23);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
