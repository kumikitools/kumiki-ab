import type {
  Change,
  KumikiConfig,
  Test,
  UrlTargeting,
} from "@kumikitools/schema";
import type { TestRow, VariantRow } from "./env";

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
 * `antiFlickerTimeout`/`ga4` are optional and not yet per-site columns, so the
 * MVP config is `{ tests }`; both stay omitted until they have a home in §2a.
 */
export function serializeConfig(
  items: { test: TestRow; variants: VariantRow[] }[],
): KumikiConfig {
  return { tests: items.map(({ test, variants }) => toContractTest(test, variants)) };
}
