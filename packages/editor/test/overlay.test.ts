// Integration verify for the overlay: drive a real pick → author → preview →
// send cycle against a fixture DOM, exercising overlay.ts end-to-end together
// with selector.ts / guardrail.ts. This is the in-process stand-in for the live
// bookmarklet flow (the postMessage transport itself is covered in messages.test).
import { Overlay } from "../src/overlay";
import type { Change } from "@kumikitools/schema";

function shadow(): ShadowRoot {
  const host = document.getElementById("kumiki-editor-root");
  if (!host?.shadowRoot) throw new Error("overlay not mounted");
  return host.shadowRoot;
}

function clickButton(label: string): void {
  const btn = Array.from(shadow().querySelectorAll("button")).find((b) =>
    b.textContent?.includes(label),
  );
  if (!btn) throw new Error(`button "${label}" not found`);
  btn.click();
}

describe("Overlay — pick → author → send", () => {
  let sent: Change[] | null;
  let overlay: Overlay;

  beforeEach(() => {
    sent = null;
    document.body.innerHTML = `
      <header id="masthead"><h1 class="page-title">Old headline</h1></header>
      <main><a class="cta">Buy now</a></main>`;
    overlay = new Overlay({
      initialChanges: [],
      hasDashboard: true,
      onSend: (changes) => {
        sent = changes;
      },
    });
    overlay.mount();
  });

  afterEach(() => overlay.destroy());

  it("picks an element, authors a text change, previews it, and sends it", () => {
    const h1 = document.querySelector("h1") as HTMLElement;

    // Pick: the overlay listens in the capture phase on document.
    h1.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Authoring row shows the generated selector — the unique stable class is
    // preferred over a positional scope (§9.6 stability ranking).
    const code = shadow().querySelector(".kx-code");
    expect(code?.textContent).toBe(".page-title");

    // Author a text change.
    const select = shadow().querySelector("select") as HTMLSelectElement;
    select.value = "text";
    select.dispatchEvent(new Event("change"));
    const textarea = shadow().querySelector("textarea.kx-value") as HTMLTextAreaElement;
    textarea.value = "New headline";
    clickButton("Add change");

    // Live preview mutated the real element.
    expect(h1.textContent).toBe("New headline");

    // Send to dashboard.
    clickButton("Send");
    expect(sent).toEqual([
      { selector: ".page-title", type: "text", value: "New headline" },
    ]);
  });

  it("refuses to pick a checkout/payment element (guardrail)", () => {
    document.body.innerHTML = `<form><input autocomplete="cc-number" id="card"></form>`;
    const card = document.querySelector("#card") as HTMLElement;
    card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // No authoring row appears; a warning is shown instead.
    expect(shadow().querySelector(".kx-code")).toBeNull();
    expect(shadow().querySelector(".kx-warn")?.textContent).toMatch(/payment|checkout/i);
  });

  it("seeds from existing changes so the user extends rather than restarts", () => {
    overlay.destroy();
    overlay = new Overlay({
      initialChanges: [{ selector: "h1", type: "text", value: "x" }],
      hasDashboard: true,
      onSend: (c) => {
        sent = c;
      },
    });
    overlay.mount();
    clickButton("Send");
    expect(sent).toHaveLength(1);
  });
});
