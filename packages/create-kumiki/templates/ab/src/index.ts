import { Hono } from "hono";
import type { AppBindings } from "./env";
import { toErrorResponse } from "./errors";
import { sites } from "./routes/sites";
import { tests } from "./routes/tests";
import { testById } from "./routes/test-by-id";
import { delivery } from "./routes/delivery";
import { ingest } from "./routes/ingest";

/**
 * The Kumiki A/B Worker (ARCHITECTURE.md §3) — one Worker, three surfaces:
 *   - delivery (public, cached)      → /v1/config/:siteId, /s.js   (A3)
 *   - ingestion (public write)       → /v1/e/:siteId               (D1)
 *   - control (write-key auth)       → /v1/sites…, /v1/tests…      (A2, this file)
 *
 * A2 ships the control foundation: site bootstrap + the reference create-test
 * route. A3 adds the delivery surface (config + /s.js). D1 adds the public
 * ingestion beacon (the event-store write path).
 */
const app = new Hono<AppBindings>();

// Single error funnel: routes throw ApiError, this renders the one envelope.
app.onError(toErrorResponse);

app.get("/healthz", (c) => c.json({ ok: true }));

// Delivery surface (§3a) — public, edge-cached: /v1/config/:siteId, /s.js.
app.route("/", delivery);

// Ingestion surface (§3b) — public write: POST /v1/e/:siteId (the beacon, D1).
app.route("/v1/e", ingest);

// Control surface (§3c).
app.route("/v1/sites", sites); //                       POST /v1/sites
app.route("/v1/sites", tests); // POST/GET /v1/sites/:id/tests  (create B-/list B1)
app.route("/v1/tests", testById); // GET/PATCH/PUT/POST /v1/tests/:id…  (B2–B6)

export default app;
