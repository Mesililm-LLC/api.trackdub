import { describe, it, expect, beforeEach } from "vitest";
import {
  loadActivationConfig,
  ActivationConfigError,
  __resetActivationConfigCache,
} from "@/activation/config";
import { bindings } from "./helpers";
import { TEST_SIGNING_KEY_PEM } from "./test-keys";

function baseEnv(overrides: Record<string, string> = {}) {
  return {
    DB: bindings.DB,
    APP_ENV: "production",
    ACTIVATION_ISSUER: "https://activate.trackdub.com",
    ACTIVATION_AUDIENCE: "trackdub-license-prod",
    SIGNING_KEY_ID: "test-key-2026",
    SIGNING_KEY: TEST_SIGNING_KEY_PEM,
    ADMIN_API_TOKEN: "test-admin-token-at-least-16-chars-long",
    ...overrides,
  } as any;
}

describe("activation config validation", () => {
  beforeEach(() => {
    __resetActivationConfigCache();
  });

  it("boots in production without ALLOW_DEV_LICENSES", () => {
    const config = loadActivationConfig(baseEnv());
    expect(config.devLicensesEnabled).toBe(false);
    expect(config.public.APP_ENV).toBe("production");
  });

  it("rejects ALLOW_DEV_LICENSES=true when APP_ENV=production", () => {
    expect(() =>
      loadActivationConfig(baseEnv({ ALLOW_DEV_LICENSES: "true" })),
    ).toThrowError(ActivationConfigError);
    expect(() =>
      loadActivationConfig(baseEnv({ ALLOW_DEV_LICENSES: "true" })),
    ).toThrowError(/ALLOW_DEV_LICENSES must not be set when APP_ENV=production/);
  });

  it("allows ALLOW_DEV_LICENSES=true in development", () => {
    __resetActivationConfigCache();
    const config = loadActivationConfig(
      baseEnv({ APP_ENV: "development", ALLOW_DEV_LICENSES: "true" }),
    );
    expect(config.devLicensesEnabled).toBe(true);
  });

  it("allows ALLOW_DEV_LICENSES=true in staging", () => {
    __resetActivationConfigCache();
    const config = loadActivationConfig(
      baseEnv({ APP_ENV: "staging", ALLOW_DEV_LICENSES: "true" }),
    );
    expect(config.devLicensesEnabled).toBe(true);
  });

  it("treats ALLOW_DEV_LICENSES=false as disabled in any environment", () => {
    const config = loadActivationConfig(baseEnv({ ALLOW_DEV_LICENSES: "false" }));
    expect(config.devLicensesEnabled).toBe(false);
  });

  it("reports missing SIGNING_KEY", () => {
    const { SIGNING_KEY: _, ...noKey } = baseEnv();
    expect(() => loadActivationConfig(noKey as any)).toThrowError(ActivationConfigError);
    expect(() => loadActivationConfig(noKey as any)).toThrowError(/SIGNING_KEY/);
  });

  it("reports missing DB binding", () => {
    const { DB: _, ...noDb } = baseEnv();
    expect(() => loadActivationConfig(noDb as any)).toThrowError(/not bound/);
  });
});
