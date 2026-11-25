import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("cors-config CORS_EXTRA_ORIGINS", () => {
  const originalEnv = process.env.CORS_EXTRA_ORIGINS;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CORS_EXTRA_ORIGINS;
    } else {
      process.env.CORS_EXTRA_ORIGINS = originalEnv;
    }
  });

  it("leaves default origins unchanged when CORS_EXTRA_ORIGINS is unset or empty", async () => {
    delete process.env.CORS_EXTRA_ORIGINS;
    const { corsOrigins } = await import("../../src/config/cors-config.js");
    expect(corsOrigins).toEqual([
      "http://localhost:5173",
      "http://localhost:5174",
      "https://geargrid.live",
      "https://www.geargrid.live",
      "https://app.geargrid.live",
    ]);
  });

  it("adds trimmed comma-separated origins from CORS_EXTRA_ORIGINS and preserves them across updateCorsOrigins", async () => {
    process.env.CORS_EXTRA_ORIGINS = " http://localhost:5191 , , http://localhost:5192 ";
    const { corsOrigins, updateCorsOrigins } = await import("../../src/config/cors-config.js");
    expect(corsOrigins).toContain("http://localhost:5191");
    expect(corsOrigins).toContain("http://localhost:5192");
    expect(corsOrigins).not.toContain("");

    updateCorsOrigins(["https://app.geargrid.live", "http://localhost:5191"]);
    expect(corsOrigins).toEqual([
      "https://app.geargrid.live",
      "http://localhost:5191",
      "http://localhost:5192",
    ]);
  });
});
