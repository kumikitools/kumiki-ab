import type {
  Change,
  KumikiConfig,
  Results,
  Test,
  UrlTargeting,
  VariantResult,
} from "@kumikitools/schema";
import type { TestRow, VariantRow } from "./env";
import type { PosteriorResult } from "./stats";

/**
 * The API's test resource: the delivered-config `Test` shape (ARCH §0) plus the
 * control-plane fields D1 holds that don't ship to the snippet. This is what
 * control routes return; the delivery route (A3) emits the bare `Test` instead.
 *
 * `siteId`/`name`/`conversionWindowDays`/timestamps are control-only; everything
 * else is exactly the contract `Test`.
 */
export interface TestResource extends Test {
  siteId: string;
  name: string;
  conversionWindowDays: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Map DB rows to the **bare contract `Test`** (ARCH §0) — exactly what the
 * snippet consumes, nothing more. This is the single place that turns stored
 * columns/JSON back into the delivered shape; both the control resource
 * (`serializeTest`) and the delivery config (`serializeConfig`) build on it, so
 * the persisted config and the delivered config can never disagree.
 *
 * Optional fields are *omitted* (not null) when absent, matching `TestSchema`.
 */
export function toContractTest(test: TestRow, variants: VariantRow[]): Test {
  return {
    id: test.id,
    status: test.status as Test["status"],
    ...(test.coverage === null ? {} : { coverage: test.coverage }),
    ...(test.winner === null ? {} : { winner: test.winner }),
    ...(test.url_match === null
      ? {}
      : { urlMatch: JSON.parse(test.url_match) as UrlTargeting }),
    variants: variants.map((v) => ({
      id: v.id,
      weight: v.weight,
      ...(v.changes === "[]"
        ? {}
        : { changes: JSON.parse(v.changes) as Change[] }),
    })),
  };
}

/** Turn DB rows into the API test resource (contract `Test` + control fields). */
export function serializeTest(
  test: TestRow,
  variants: VariantRow[],
): TestResource {
  return {
    ...toContractTest(test, variants),
    siteId: test.site_id,
    name: test.name,
    conversionWindowDays: test.conversion_window_days,
    createdAt: test.created_at,
    updatedAt: test.updated_at,
  };
}

/**
 * Flatten a site's tests into the exact `KumikiConfig` the snippet consumes
 * (ARCH §3a). A pure flatten with no policy: every test is emitted with its
 * `status`, and the snippet honours running/applied/stopped — the kill switch
 * (B6) works by flipping status + purging cache, not by filtering here.
 *
 * When `meta` is provided (D3+) the config self-describes for the beacon:
 * `siteId` + `ingestUrl` let the snippet address POST /v1/e/:siteId without
 * knowing the request origin; `goals` is [] until goal authoring lands (TASK-21).
 */
export function serializeConfig(
  items: { test: TestRow; variants: VariantRow[] }[],
  meta?: { siteId: string; ingestUrl: string },
): KumikiConfig {
  const tests = items.map(({ test, variants }) => toContractTest(test, variants));
  if (!meta) return { tests };
  return { tests, siteId: meta.siteId, ingestUrl: meta.ingestUrl, goals: [] };
}

/**
 * Turn the computed posteriors (`stats.computePosteriors`) into the `Results`
 * wire contract (ARCH §4). The single place that shapes the results response, so
 * the API producer and the MCP/dashboard consumers agree by construction — the
 * same role `serializeConfig`/`serializeTest` play for the config surface.
 *
 * `revPerVisitor` is carried through per-variant only when revenue was tracked
 * (the posterior leaves it undefined otherwise), matching the optional field in
 * `VariantResultSchema`.
 */
export function serializeResults(
  testId: string,
  windowDays: number,
  posterior: PosteriorResult,
): Results {
  const variants: VariantResult[] = posterior.variants.map((v) => ({
    id: v.id,
    exposed: v.exposed,
    converted: v.converted,
    rate: v.rate,
    pBest: v.pBest,
    ci95: v.ci95,
    ...(v.revPerVisitor === undefined ? {} : { revPerVisitor: v.revPerVisitor }),
  }));

  return {
    testId,
    windowDays,
    variants,
    ...(posterior.winner === undefined ? {} : { winner: posterior.winner }),
  };
}
