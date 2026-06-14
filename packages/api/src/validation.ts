import { z } from "zod";
import {
  TestStatusSchema,
  UrlTargetingSchema,
  VariantSchema,
} from "@kumikitools/schema";
import type { Context } from "hono";
import { ApiError } from "./errors";

/**
 * API request schemas — the validation reference pattern. These build on the
 * shared contract primitives from `@kumikitools/schema` (the single source of
 * truth) and add only the control-plane fields D1 stores that aren't part of the
 * delivered `KumikiConfig` (e.g. `name`, `conversionWindowDays`).
 *
 * Rule: never re-declare a contract type here. Import it from the schema package
 * and compose. If a field belongs in the delivered config, it belongs in the
 * schema package, not here.
 */

/** Body for `POST /v1/sites/:id/tests`. */
export const CreateTestRequestSchema = z
  .object({
    /** Optional explicit id; server generates one (`tst_…`) when omitted. */
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    status: TestStatusSchema.default("running"),
    /** Fraction [0,1] of visitors entered into the experiment. */
    coverage: z.number().min(0).max(1).optional(),
    /** W for the user-based conversion window (ARCH §4). */
    conversionWindowDays: z.number().int().positive().default(7),
    urlMatch: UrlTargetingSchema.optional(),
    variants: z.array(VariantSchema).min(1),
    /** Only meaningful with status = "applied"; must name a real variant. */
    winner: z.string().optional(),
  })
  .superRefine((body, ctx) => {
    const ids = body.variants.map((v) => v.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variants"],
        message: "variant ids must be unique within a test",
      });
    }
    if (body.winner !== undefined && !ids.includes(body.winner)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["winner"],
        message: "winner must reference one of the test's variant ids",
      });
    }
  });

export type CreateTestRequest = z.infer<typeof CreateTestRequestSchema>;

/**
 * Body for `PATCH /v1/tests/:id` (B3). Every field is optional — a partial edit
 * of the control-plane test (status / coverage / window / name / targeting). At
 * least one field must be present, else the request is a no-op (400). `winner`
 * is intentionally absent here: it's set by the deliberate `apply` route (B5),
 * not a general edit.
 */
export const PatchTestRequestSchema = z
  .object({
    name: z.string().min(1).optional(),
    status: TestStatusSchema.optional(),
    coverage: z.number().min(0).max(1).optional(),
    conversionWindowDays: z.number().int().positive().optional(),
    urlMatch: UrlTargetingSchema.optional(),
  })
  .superRefine((body, ctx) => {
    if (Object.keys(body).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "provide at least one field to update",
      });
    }
  });

export type PatchTestRequest = z.infer<typeof PatchTestRequestSchema>;

/**
 * Body for `PUT /v1/tests/:id/variants` (B4) — replace the whole variant set.
 * Reuses the contract `VariantSchema` (so `changes[]` is validated by the single
 * source of truth) and only adds the test-level invariant that ids are unique.
 */
export const ReplaceVariantsRequestSchema = z
  .object({
    variants: z.array(VariantSchema).min(1),
  })
  .superRefine((body, ctx) => {
    const ids = body.variants.map((v) => v.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variants"],
        message: "variant ids must be unique within a test",
      });
    }
  });

export type ReplaceVariantsRequest = z.infer<typeof ReplaceVariantsRequestSchema>;

/**
 * Body for `POST /v1/tests/:id/apply` (B5). `winner` names the variant rolled to
 * 100%. That it references a *real* variant of this test needs the DB, so the
 * route checks it (404/400) after this shape check — not here.
 */
export const ApplyTestRequestSchema = z.object({
  winner: z.string().min(1),
});

export type ApplyTestRequest = z.infer<typeof ApplyTestRequestSchema>;

/**
 * Parse + validate a JSON request body against a zod schema. On any failure
 * throws an `ApiError` (400 `invalid_body`) carrying flattened zod issues in
 * `details`. Routes call this instead of touching `c.req.json()` directly.
 */
export async function validateJson<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body is not valid JSON");
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(
      400,
      "invalid_body",
      "Request body failed validation",
      result.error.flatten(),
    );
  }
  return result.data;
}
