"use client";

import { useActionState } from "react";
import { emptyState, saveVariantsAction } from "@/app/actions";
import { VariantsEditor } from "@/components/VariantsEditor";
import { SubmitButton } from "@/components/SubmitButton";
import { FormAlert } from "@/components/FormAlert";
import type { Variant } from "@/lib/types";

/** Replace the whole variant set (B4 PUT). Pre-filled from the stored variants. */
export function VariantsForm({
  testId,
  variants,
}: {
  testId: string;
  variants: Variant[];
}) {
  const [state, formAction] = useActionState(saveVariantsAction, emptyState);

  return (
    <form action={formAction}>
      <FormAlert state={state} />
      <input type="hidden" name="testId" value={testId} />
      <VariantsEditor initial={variants} />
      <div className="actions">
        <SubmitButton pendingLabel="Saving…">Save variants</SubmitButton>
      </div>
    </form>
  );
}
