import { Hono } from "hono";
import type { AppBindings } from "./env";
import { toErrorResponse } from "./errors";
import { sites } from "./routes/sites";
import { tests } from "./routes/tests";
import { delivery } from "./routes/delivery";

/**
 * The Kumiki A/B Worker (ARCHITECTURE.md §3) — one Worker, three surfaces:
 *   - delivery (public, cached)      → /v1/config/:siteId, /s.js   (A3)
 *   - ingestion (public write)       → /v1/e/:siteId               (D1)
 *   - control (write-key auth)       → /v1/sites…, /v1/tests…      (A2, this file)
 *
 * A2 ships the control foundation: site bootstrap + the reference create-test
 * route. A3 adds the delivery surface (config + /s.js). Ingestion mounts later.
 */
const app = new Hono<AppBindings>();

// Single error funnel: routes throw ApiError, this renders the one envelope.
app.onError(toErrorResponse);

app.get("/healthz", (c) => c.json({ ok: true }));

// Delivery surface (§3a) — public, edge-cached: /v1/config/:siteId, /s.js.
app.route("/", delivery);

// Control surface (§3c).
app.route("/v1/sites", sites); //            POST /v1/sites
app.route("/v1/sites", tests); // POST /v1/sites/:id/tests

export default app;
