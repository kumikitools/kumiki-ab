import type { FormState } from "@/app/actions";

/** Renders the success/error banner for a server-action form state. */
export function FormAlert({ state }: { state: FormState }) {
  if (state.error) {
    return (
      <div className="alert error">
        {state.error}
        {state.code ? (
          <>
            {" "}
            <code>({state.code})</code>
          </>
        ) : null}
      </div>
    );
  }
  if (state.ok && state.message) {
    return <div className="alert ok">{state.message}</div>;
  }
  return null;
}
