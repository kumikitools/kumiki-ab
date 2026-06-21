import { Hono } from "hono";
import type { Goal } from "@kumikitools/schema";
import type { AppBindings } from "../env";
import { siteAuth } from "../auth";
import { getSite, updateSiteGoals } from "../db";
import { SetGoalsRequestSchema, validateJson } from "../validation";
import { purgeSiteCache } from "../cache";
import { ApiError } from "../errors";

/**
 * Site-level goal authoring routes (TASK-21). Mounted under `/v1/sites`, so
 * `:id` is the siteId — every route is gated by `siteAuth()`. Mirrors the B4
 * replace-whole-set pattern: validate → write → purge → read back.
 *
 * GET /v1/sites/:id/goals — read the stored goal set.
 * PUT /v1/sites/:id/goals — replace the whole goal set (atomic, cache-purged).
 */
export const siteGoals = new Hono<AppBindings>();

siteGoals.get("/:id/goals", siteAuth(), (c) => {
  const site = c.get("site");
  const goals = JSON.parse(site.goals) as Goal[];
  return c.json({ goals });
});

siteGoals.put("/:id/goals", siteAuth(), async (c) => {
  const site = c.get("site");
  const body = await validateJson(c, SetGoalsRequestSchema);

  await updateSiteGoals(c.env.DB, site.id, JSON.stringify(body.goals));
  await purgeSiteCache(site.id);

  const updated = await getSite(c.env.DB, site.id);
  if (!updated) {
    // Unreachable: siteAuth proved the site exists and the write above succeeded.
    throw new ApiError(500, "internal_error", "Internal server error");
  }
  const goals = JSON.parse(updated.goals) as Goal[];
  return c.json({ goals });
});
