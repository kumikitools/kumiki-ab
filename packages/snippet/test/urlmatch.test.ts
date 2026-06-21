import { describe, expect, it } from "vitest";
import { matchesPattern, matchesUrl } from "../src/urlmatch";

const URL = "https://shop.example.com/products/42?ref=home";

describe("matchesPattern", () => {
  it("exact", () => {
    expect(matchesPattern({ type: "exact", value: URL }, URL)).toBe(true);
    expect(matchesPattern({ type: "exact", value: "https://shop.example.com/" }, URL)).toBe(false);
  });

  it("prefix", () => {
    expect(matchesPattern({ type: "prefix", value: "https://shop.example.com/products" }, URL)).toBe(true);
    expect(matchesPattern({ type: "prefix", value: "https://shop.example.com/cart" }, URL)).toBe(false);
  });

  it("contains", () => {
    expect(matchesPattern({ type: "contains", value: "/products/" }, URL)).toBe(true);
    expect(matchesPattern({ type: "contains", value: "checkout" }, URL)).toBe(false);
  });

  it("wildcard", () => {
    expect(matchesPattern({ type: "wildcard", value: "https://shop.example.com/products/*" }, URL)).toBe(true);
    expect(matchesPattern({ type: "wildcard", value: "*/products/*" }, URL)).toBe(true);
    expect(matchesPattern({ type: "wildcard", value: "*/cart/*" }, URL)).toBe(false);
    // The "." in the host must be literal, not "any char".
    expect(matchesPattern({ type: "wildcard", value: "https://shopXexample.com/*" }, URL)).toBe(false);
  });

  it("regex", () => {
    expect(matchesPattern({ type: "regex", value: "/products/\\d+" }, URL)).toBe(true);
    expect(matchesPattern({ type: "regex", value: "/products/[a-z]+$" }, URL)).toBe(false);
  });

  it("fails closed on an invalid regex", () => {
    expect(matchesPattern({ type: "regex", value: "(" }, URL)).toBe(false);
  });
});

describe("matchesUrl", () => {
  it("runs everywhere when targeting is omitted", () => {
    expect(matchesUrl(undefined, URL)).toBe(true);
  });

  it("runs everywhere when include is empty", () => {
    expect(matchesUrl({ include: [] }, URL)).toBe(true);
  });

  it("requires an include match when includes are present", () => {
    expect(matchesUrl({ include: [{ type: "contains", value: "/products/" }] }, URL)).toBe(true);
    expect(matchesUrl({ include: [{ type: "contains", value: "/blog/" }] }, URL)).toBe(false);
  });

  it("excludes always win over includes", () => {
    const targeting = {
      include: [{ type: "prefix" as const, value: "https://shop.example.com/" }],
      exclude: [{ type: "contains" as const, value: "ref=home" }],
    };
    expect(matchesUrl(targeting, URL)).toBe(false);
  });

  it("matches when include passes and no exclude hits", () => {
    const targeting = {
      include: [{ type: "prefix" as const, value: "https://shop.example.com/" }],
      exclude: [{ type: "contains" as const, value: "/checkout" }],
    };
    expect(matchesUrl(targeting, URL)).toBe(true);
  });
});
