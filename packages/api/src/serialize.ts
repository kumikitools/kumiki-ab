import type { Change, Test, UrlTargeting } from "@kumikitools/schema";
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

/** Turn DB rows back into the API test resource (inverse of the create handler). */
export function serializeTest(
  test: TestRow,
  variants: VariantRow[],
): TestResource {
  return {
    id: test.id,
    siteId: test.site_id,
    name: test.name,
    status: test.status as Test["status"],
    ...(test.coverage === null ? {} : { coverage: test.coverage }),
    ...(test.winner === null ? {} : { winner: test.winner }),
    conversionWindowDays: test.conversion_window_days,
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
    createdAt: test.created_at,
    updatedAt: test.updated_at,
  };
}
