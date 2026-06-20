-- Goal authoring (TASK-21) — site-level conversion goals stored as JSON on the
-- site row. Whole-set replace-only (no per-goal CRUD). Existing sites default to
-- an empty array; insertSite's 4-column INSERT is unchanged (no backfill needed).
ALTER TABLE site ADD COLUMN goals TEXT NOT NULL DEFAULT '[]';
