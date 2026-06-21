// The postMessage contract: only versioned, token-matched editor messages are
// accepted. This is the wire-level half of the §9.7 security model (the receiver
// also checks event.origin).
import { parseEditorMessage, KUMIKI_EDITOR, PROTOCOL_VERSION } from "../src/messages";

const TOKEN = "sess_abc123";

function msg(over: Record<string, unknown> = {}) {
  return {
    kumiki: KUMIKI_EDITOR,
    v: PROTOCOL_VERSION,
    type: "changes",
    token: TOKEN,
    changes: [{ selector: "h1", type: "text", value: "Hi" }],
    ...over,
  };
}

describe("parseEditorMessage", () => {
  it("accepts a well-formed, token-matched message", () => {
    const m = parseEditorMessage(msg(), TOKEN);
    expect(m?.type).toBe("changes");
  });

  it("rejects a mismatched token (drive-by injection)", () => {
    expect(parseEditorMessage(msg(), "other")).toBeNull();
  });

  it("rejects the wrong namespace or version", () => {
    expect(parseEditorMessage(msg({ kumiki: "evil" }), TOKEN)).toBeNull();
    expect(parseEditorMessage(msg({ v: 999 }), TOKEN)).toBeNull();
  });

  it("rejects unknown message types and non-objects", () => {
    expect(parseEditorMessage(msg({ type: "boom" }), TOKEN)).toBeNull();
    expect(parseEditorMessage("nope", TOKEN)).toBeNull();
    expect(parseEditorMessage(null, TOKEN)).toBeNull();
  });
});
