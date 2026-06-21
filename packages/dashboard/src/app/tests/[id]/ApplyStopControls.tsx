"use client";

import { useActionState } from "react";
import {
  applyWinnerAction,
  emptyState,
  stopTestAction,
} from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { FormAlert } from "@/components/FormAlert";
import type { TestResource } from "@/lib/types";

/**
 * The two deliberate, reversible lifecycle actions (ARCH guardrails): apply a
 * winner to 100% (B5) and the instant kill switch (B6). Kept distinct from the
 * general edit form because they are decisions, not field tweaks.
 */
export function ApplyStopControls({ test }: { test: TestResource }) {
  const [applyState, applyAction] = useActionState(applyWinnerAction, emptyState);
  const [stopState, stopAction] = useActionState(stopTestAction, emptyState);

  return (
    <div>
      <form action={applyAction}>
        <FormAlert state={applyState} />
        <input type="hidden" name="testId" value={test.id} />
        <label>Apply a winner — rolls one variant to 100% of traffic</label>
        <div className="field-grid">
          <select name="winner" defaultValue={test.winner ?? ""}>
            <option value="" disabled>
              Pick a variant…
            </option>
            {test.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id}
              </option>
            ))}
          </select>
          <SubmitButton pendingLabel="Applying…">Apply winner</SubmitButton>
        </div>
      </form>

      <form action={stopAction} style={{ marginTop: 18 }}>
        <FormAlert state={stopState} />
        <input type="hidden" name="testId" value={test.id} />
        <label>
          Kill switch <span className="hint">— everyone sees the original, cache purged instantly</span>
        </label>
        <SubmitButton className="danger" pendingLabel="Stopping…">
          Stop test
        </SubmitButton>
      </form>
    </div>
  );
}
