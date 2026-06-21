import type { TestStatus } from "@/lib/types";

/** The test status as a coloured pill — running / applied / stopped. */
export function StatusBadge({ status }: { status: TestStatus }) {
  return <span className={`badge ${status}`}>{status}</span>;
}
