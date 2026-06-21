"use client";

/**
 * Route error boundary — turns a thrown config/transport error into a readable
 * panel instead of a blank 500. The most common cause in F1 is a missing env var
 * (the fail-fast `ConfigError` from `loadConfig`) or an unreachable Worker.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div>
      <h1>Something went wrong</h1>
      <div className="alert error">{error.message}</div>
      <p className="subtle">
        If this names a missing <code>KUMIKI_*</code> variable, set it and restart
        the dashboard. If it&apos;s a network error, check that{" "}
        <code>KUMIKI_API_URL</code> points at a reachable Worker.
      </p>
      <div className="actions">
        <button className="primary" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
