import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings, SiteRow } from "../env";
import { insertSite } from "../db";
import { generateWriteKey, sha256Hex } from "../crypto";
import { validateJson } from "../validation";

/**
 * Site bootstrap (ARCH §3c). This is the one control route that CANNOT require a
 * write key — it's where the key is minted. It hashes and stores the key, then
 * returns the plaintext ONCE. Every other control route is gated by `siteAuth`.
 */
const CreateSiteRequestSchema = z.object({
  name: z.string().min(1),
});

export const sites = new Hono<AppBindings>();

sites.post("/", async (c) => {
  const body = await validateJson(c, CreateSiteRequestSchema);

  const writeKey = generateWriteKey();
  const site: SiteRow = {
    id: `site_${crypto.randomUUID()}`,
    name: body.name,
    api_key_hash: await sha256Hex(writeKey),
    created_at: Date.now(),
  };

  await insertSite(c.env.DB, site);

  // `writeKey` is returned exactly once — it is never recoverable afterwards.
  return c.json(
    {
      id: site.id,
      name: site.name,
      createdAt: site.created_at,
      writeKey,
    },
    201,
  );
});
