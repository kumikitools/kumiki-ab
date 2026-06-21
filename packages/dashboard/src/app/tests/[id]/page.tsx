import Link from "next/link";
import { getClient } from "@/lib/api";
import { ApiClientError } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { ResultsPanel } from "@/components/ResultsPanel";
import { coveragePct, formatTs } from "@/lib/format";
import type { Results } from "@/lib/types";
import { EditTestForm } from "./EditTestForm";
import { VariantsForm } from "./VariantsForm";
import { ApplyStopControls } from "./ApplyStopControls";

// Control state changes out-of-band (MCP, other operators) — never cache.
export const dynamic = "force-dynamic";

export default async function TestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = getClient();
  const test = await client.getTest(id);

  // Results are best-effort: a brand-new test with no events still returns, but
  // surface any failure inline rather than failing the whole page.
  let results: Results | null = null;
  let resultsError: string | null = null;
  try {
    results = await client.getResults(id);
  } catch (e) {
    resultsError =
      e instanceof ApiClientError ? `${e.message} (${e.code})` : String(e);
  }

  return (
    <div>
      <Link href="/" className="back">
        ← All tests
      </Link>

      <div className="row-between">
        <div>
          <h1>{test.name}</h1>
          <p className="subtle">
            <span className="mono">{test.id}</span> · coverage{" "}
            {coveragePct(test.coverage)} · updated {formatTs(test.updatedAt)}
          </p>
        </div>
        <StatusBadge status={test.status} />
      </div>

      <h2>Results</h2>
      {results ? (
        <ResultsPanel results={results} />
      ) : (
        <div className="alert error">Couldn’t load results: {resultsError}</div>
      )}

      <h2>Lifecycle</h2>
      <ApplyStopControls test={test} />

      <h2>Edit</h2>
      <EditTestForm test={test} />

      <h2>Variants</h2>
      <VariantsForm testId={test.id} variants={test.variants} />
    </div>
  );
}
