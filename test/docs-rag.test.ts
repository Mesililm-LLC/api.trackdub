import { describe, expect, it } from "vitest";
import { bearerAuthorized } from "@/docs-rag/auth";
import { parseSearchBody } from "@/docs-rag/query";
import { filterForScope } from "@/docs-rag/scopes";

describe("docs-rag scopes", () => {
  it("leaves all unfiltered", () => {
    expect(filterForScope("all")).toBeUndefined();
  });

  it("builds ASCII range filters for first-party and vendor folders", () => {
    expect(filterForScope("trackdub")).toEqual({
      folder: { $gte: "first-party/trackdub/", $lt: "first-party/trackdub0" },
    });
    expect(filterForScope("nvidia")).toEqual({
      folder: { $gte: "vendor/nvidia/", $lt: "vendor/nvidia0" },
    });
  });
});

describe("docs-rag request parsing", () => {
  it("rejects an empty query", () => {
    expect(parseSearchBody({ query: "  " })).toEqual({ error: "query is required" });
  });

  it("defaults scope and limit", () => {
    expect(parseSearchBody({ query: "TRT RTX plugin" })).toEqual({
      query: "TRT RTX plugin",
      scope: "all",
      limit: 8,
    });
  });

  it("rejects unknown scopes", () => {
    expect(parseSearchBody({ query: "x", scope: "cuda" })).toEqual({ error: "unknown scope: cuda" });
  });
});

describe("docs-rag auth", () => {
  it("rejects a short configured token", () => {
    expect(bearerAuthorized("Bearer short-token", "short-token")).toBe(false);
  });

  it("accepts a matching bearer token", () => {
    const token = "docs-rag-token-16";
    expect(bearerAuthorized(`Bearer ${token}`, token)).toBe(true);
    expect(bearerAuthorized("Bearer other-token-16ch", token)).toBe(false);
  });
});
