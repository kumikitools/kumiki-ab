"use client";

import { useActionState } from "react";
import { emptyState, updateTestAction } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { FormAlert } from "@/components/FormAlert";
import type { TestResource } from "@/lib/types";

/** Edit a test's control-plane fields (B3 PATCH). Variants are a separate form. */
export function EditTestForm({ test }: { test: TestResource }) {
  const [state, formAction] = useActionState(updateTestAction, emptyState);

  return (
    <form action={formAction}>
      <FormAlert state={state} />
      <input type="hidden" name="testId" value={test.id} />

      <label>Name</label>
      <input type="text" name="name" defaultValue={test.name} />

      <div className="field-grid">
        <div>
          <label>Status</label>
          <select name="status" defaultValue={test.status}>
            <option value="running">running</option>
            <option value="stopped">stopped</option>
            {test.status === "applied" ? (
              <option value="applied">applied</option>
            ) : null}
          </select>
        </div>
        <div>
          <label>
            Coverage <span className="hint">— fraction 0–1</span>
          </label>
          <input
            type="number"
            name="coverage"
            min={0}
            max={1}
            step="any"
            defaultValue={test.coverage ?? ""}
            placeholder="1"
          />
        </div>
      </div>

      <label>Conversion window (days)</label>
      <input
        type="number"
        name="conversionWindowDays"
        min={1}
        step={1}
        defaultValue={test.conversionWindowDays}
      />

      <label>
        URL targeting <span className="hint">— JSON; blank leaves it unchanged</span>
      </label>
      <textarea
        name="urlMatchJson"
        spellCheck={false}
        defaultValue={test.urlMatch ? JSON.stringify(test.urlMatch, null, 2) : ""}
        placeholder="(runs on every page when unset)"
      />

      <div className="actions">
        <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
      </div>
    </form>
  );
}
