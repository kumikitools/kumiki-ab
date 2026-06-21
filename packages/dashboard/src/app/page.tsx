import Link from "next/link";
import { getClient } from "@/lib/api";
import { loadConfig } from "@/lib/env";
import { StatusBadge } from "@/components/StatusBadge";
import { coveragePct } from "@/lib/format";

// Always render fresh — the control state changes out-of-band (MCP, other operators).
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { siteId } = loadConfig();
  const tests = await getClient().listTests();

  return (
    <div>
      <div className="row-between">
        <div>
          <h1>Tests</h1>
          <p className="subtle">
            Site <span className="mono">{siteId}</span> · {tests.length}{" "}
            {tests.length === 1 ? "test" : "tests"}
          </p>
        </div>
        <Link href="/tests/new" className="btn primary">
          + New test
        </Link>
      </div>

      {tests.length === 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <p style={{ margin: 0 }}>No tests yet.</p>
          <p className="subtle" style={{ marginBottom: 0 }}>
            Create one here, or from Claude Code via the{" "}
            <span className="mono">kumiki_create_test</span> MCP tool.
          </p>
        </div>
      ) : (
        <ul className="test-list">
          {tests.map((t) => (
            <li key={t.id}>
              <div className="row-between">
                <div>
                  <Link href={`/tests/${t.id}`} className="name">
                    {t.name}
                  </Link>
                  <div className="meta">
                    {t.variants.length} variants · coverage{" "}
                    {coveragePct(t.coverage)} · {t.conversionWindowDays}-day window
                    {t.winner ? (
                      <>
                        {" "}
                        · winner <span className="mono">{t.winner}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                <StatusBadge status={t.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
