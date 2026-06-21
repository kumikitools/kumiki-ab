/**
 * Dashboard-facing types. The contract shapes (`Test`, `Variant`, `Results`,
 * targeting) come from `@kumikitools/schema` — the single source of truth — and
 * are never re-declared here. We only describe the control-plane envelopes the
 * API adds on top (the same fields `packages/api/src/serialize.ts` returns) and
 * the request bodies the control routes accept.
 */
import type {
  Results,
  Test,
  TestStatus,
  UrlTargeting,
  Variant,
} from "@kumikitools/schema";

export type { Results, Test, TestStatus, UrlTargeting, Variant };

/**
 * The control-route test resource: the delivered-config `Test` plus the
 * control-only fields D1 holds (mirrors `TestResource` in the API package).
 */
export interface TestResource extends Test {
  siteId: string;
  name: string;
  conversionWindowDays: number;
  createdAt: number;
  updatedAt: number;
}

/** Body for `POST /v1/sites/:id/tests`. */
export interface CreateTestBody {
  name: string;
  status?: TestStatus;
  coverage?: number;
  conversionWindowDays?: number;
  urlMatch?: UrlTargeting;
  variants: Variant[];
  winner?: string;
}

/** Body for `PATCH /v1/tests/:id` — every field optional, ≥1 required. */
export interface PatchTestBody {
  name?: string;
  status?: TestStatus;
  coverage?: number;
  conversionWindowDays?: number;
  urlMatch?: UrlTargeting;
}

/** The API error envelope (ARCH §3c) — `code` is the stable, surfaced contract. */
export interface ApiErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}
