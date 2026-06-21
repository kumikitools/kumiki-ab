"use client";

import { useMemo, useState } from "react";
import type { Variant } from "@/lib/types";

/**
 * Edits a test's `variants[]` and serialises them into a hidden field the form
 * action reads (`variantsJson`). Each variant is an id, a relative weight, and a
 * `changes[]` payload authored as JSON (the no-code visual authoring of `changes`
 * is the deferred F2 iframe editor — see TASKS.md). The API stays the authority
 * on shape; this island only assembles a valid JSON array and blocks submit while
 * the `changes` JSON is malformed, so the action never receives garbage.
 */
interface Editable {
  id: string;
  weight: string;
  changesText: string;
}

function toEditable(v: Variant): Editable {
  return {
    id: v.id,
    weight: String(v.weight ?? 1),
    changesText: v.changes && v.changes.length ? JSON.stringify(v.changes, null, 2) : "[]",
  };
}

const CONTROL: Editable = { id: "control", weight: "1", changesText: "[]" };
const NEW_VARIANT: Editable = { id: "variant-b", weight: "1", changesText: "[]" };

export function VariantsEditor({
  name = "variantsJson",
  initial,
}: {
  name?: string;
  initial?: Variant[];
}) {
  const [rows, setRows] = useState<Editable[]>(
    initial && initial.length ? initial.map(toEditable) : [CONTROL, { ...NEW_VARIANT }],
  );

  const { json, error } = useMemo(() => serialize(rows), [rows]);

  function update(i: number, patch: Partial<Editable>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function remove(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }
  function add() {
    setRows((rs) => [...rs, { id: `variant-${rs.length + 1}`, weight: "1", changesText: "[]" }]);
  }

  return (
    <div>
      {rows.map((r, i) => (
        <div className="variant-row" key={i}>
          <div className="top">
            <div>
              <label>
                Variant id{" "}
                <span className="hint">— stable, unique within the test</span>
              </label>
              <input
                type="text"
                value={r.id}
                onChange={(e) => update(i, { id: e.target.value })}
                placeholder="control"
              />
            </div>
            <div>
              <label>
                Weight <span className="hint">— relative split</span>
              </label>
              <input
                type="number"
                min={0}
                step="any"
                value={r.weight}
                onChange={(e) => update(i, { weight: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="remove danger"
              onClick={() => remove(i)}
              disabled={rows.length <= 1}
              title={rows.length <= 1 ? "A test needs at least one variant" : "Remove"}
            >
              Remove
            </button>
          </div>
          <label>
            Changes <span className="hint">— DOM mutations as a JSON array (empty for control)</span>
          </label>
          <textarea
            value={r.changesText}
            onChange={(e) => update(i, { changesText: e.target.value })}
            spellCheck={false}
            placeholder='[{ "selector": "h1", "type": "text", "value": "New headline" }]'
          />
        </div>
      ))}

      <div className="actions" style={{ marginTop: 4 }}>
        <button type="button" onClick={add}>
          + Add variant
        </button>
      </div>

      {error ? <div className="alert error">{error}</div> : null}
      <input type="hidden" name={name} value={error ? "" : json} />
    </div>
  );
}

/** Build the `variants[]` JSON, or report the first malformed `changes` field. */
function serialize(rows: Editable[]): { json: string; error: string | null } {
  const out: Variant[] = [];
  for (const r of rows) {
    const id = r.id.trim();
    if (!id) return { json: "", error: "Every variant needs an id." };
    const weight = Number(r.weight);
    if (!Number.isFinite(weight)) {
      return { json: "", error: `Variant “${id}” has a non-numeric weight.` };
    }
    let changes: unknown;
    try {
      changes = JSON.parse(r.changesText || "[]");
    } catch {
      return { json: "", error: `Variant “${id}” — changes is not valid JSON.` };
    }
    if (!Array.isArray(changes)) {
      return { json: "", error: `Variant “${id}” — changes must be a JSON array.` };
    }
    out.push({ id, weight, changes: changes as Variant["changes"] });
  }
  const ids = out.map((v) => v.id);
  if (new Set(ids).size !== ids.length) {
    return { json: "", error: "Variant ids must be unique." };
  }
  return { json: JSON.stringify(out), error: null };
}
