import Link from "next/link";
import { CreateTestForm } from "./CreateTestForm";

export default function NewTestPage() {
  return (
    <div>
      <Link href="/" className="back">
        ← All tests
      </Link>
      <h1>New test</h1>
      <p className="subtle">
        Created under the configured site. The same operation is available from
        Claude Code via <span className="mono">kumiki_create_test</span>.
      </p>
      <CreateTestForm />
    </div>
  );
}
