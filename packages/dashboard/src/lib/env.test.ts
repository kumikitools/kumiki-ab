import { describe, expect, it } from "vitest";
import { loadConfig } from "./env";

const ok = {
  KUMIKI_API_URL: "https://kumiki.example.workers.dev",
  KUMIKI_API_KEY: "wk_secret",
  KUMIKI_SITE_ID: "site_123",
};

describe("loadConfig", () => {
  it("reads all three vars", () => {
    expect(loadConfig(ok)).toEqual({
      apiUrl: "https://kumiki.example.workers.dev",
      apiKey: "wk_secret",
      siteId: "site_123",
    });
  });

  it("strips a trailing slash from the API url and trims values", () => {
    const cfg = loadConfig({
      ...ok,
      KUMIKI_API_URL: "https://kumiki.example.workers.dev/",
      KUMIKI_SITE_ID: "  site_123  ",
    });
    expect(cfg.apiUrl).toBe("https://kumiki.example.workers.dev");
    expect(cfg.siteId).toBe("site_123");
  });

  it.each(["KUMIKI_API_URL", "KUMIKI_API_KEY", "KUMIKI_SITE_ID"])(
    "fails fast when %s is missing",
    (missing) => {
      const env = { ...ok } as Record<string, string>;
      delete env[missing];
      expect(() => loadConfig(env)).toThrow(missing);
    },
  );

  it("rejects a blank var", () => {
    expect(() => loadConfig({ ...ok, KUMIKI_API_KEY: "   " })).toThrow(
      "KUMIKI_API_KEY",
    );
  });

  it("rejects a malformed API url", () => {
    expect(() => loadConfig({ ...ok, KUMIKI_API_URL: "not a url" })).toThrow(
      "valid URL",
    );
  });
});
