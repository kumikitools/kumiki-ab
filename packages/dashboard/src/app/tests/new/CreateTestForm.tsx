"use client";

import { useActionState } from "react";
import { createTestAction, emptyState } from "@/app/actions";
import { VariantsEditor } from "@/components/VariantsEditor";
import { SubmitButton } from "@/components/SubmitButton";
import { FormAlert } from "@/components/FormAlert";

export function CreateTestForm() {
  const [state, formAction] = useActionState(createTestAction, emptyState);

  return (
    <form action={formAction}>
      <FormAlert state={state} />

      <label>Name</label>
      <input type="text" name="name" required placeholder="Homepage hero copy" />

      <div className="field-grid">
        <div>
          <label>Status</label>
          <select name="status" defaultValue="running">
            <option value="running">running</option>
            <option value="stopped">stopped</option>
          </select>
        </div>
        <div>
          <label>
            Coverage <span className="hint">— fraction 0–1, blank = 100%</span>
          </label>
          <input type="number" name="coverage" min={0} max={1} step="any" placeholder="1" />
        </div>
      </div>

      <label>
        Conversion window (days){" "}
        <span className="hint">— blank = 7 (the API default)</span>
      </label>
      <input
        type="number"
        name="conversionWindowDays"
        min={1}
        step={1}
        placeholder="7"
      />

      <label>
        URL targeting{" "}
        <span className="hint">
          — optional JSON, e.g. {`{"include":[{"type":"prefix","value":"https://site.com/"}]}`}
        </span>
      </label>
      <textarea name="urlMatchJson" spellCheck={false} placeholder="(runs on every page when blank)" />

      <h2>Variants</h2>
      <VariantsEditor />

      <div className="actions">
        <SubmitButton pendingLabel="Creating…">Create test</SubmitButton>
      </div>
    </form>
  );
}
