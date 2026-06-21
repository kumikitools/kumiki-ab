// §3 guardrail: the editor must never author a change on a checkout/payment
// element. Fail-safe — over-blocking is fine, authoring a payment change is not.
import { checkGuardrail } from "../src/guardrail";

function el(html: string): Element {
  document.body.innerHTML = html;
  return document.body.firstElementChild as Element;
}

describe("checkGuardrail", () => {
  it("blocks the entire page when the URL is a checkout flow", () => {
    const v = checkGuardrail(el(`<h1>Title</h1>`), "https://shop.example.com/checkout");
    expect(v.blocked).toBe(true);
  });

  it("blocks Japanese checkout URLs (決済 / 購入)", () => {
    const v = checkGuardrail(el(`<h1>X</h1>`), "https://shop.example.jp/購入手続き");
    expect(v.blocked).toBe(true);
  });

  it("blocks an element whose attributes scream payment", () => {
    const v = checkGuardrail(
      el(`<input name="card-number" placeholder="Card number">`),
      "https://shop.example.com/product/123",
    );
    expect(v.blocked).toBe(true);
  });

  it("blocks an element inside a payment form (cc-* autocomplete)", () => {
    const node = el(
      `<form><label id="lbl">Name</label><input autocomplete="cc-number"></form>`,
    );
    const label = node.querySelector("#lbl") as Element;
    const v = checkGuardrail(label, "https://shop.example.com/p/1");
    expect(v.blocked).toBe(true);
  });

  it("allows a normal hero/CTA on a normal page", () => {
    const v = checkGuardrail(
      el(`<button class="hero-cta">Learn more</button>`),
      "https://shop.example.com/lp/spring",
    );
    expect(v.blocked).toBe(false);
  });

  it("allows an 'Add to cart' button text but NOT on a /cart URL", () => {
    // The button text alone isn't a payment field; the page isn't checkout.
    const ok = checkGuardrail(
      el(`<button class="add">Add to bag</button>`),
      "https://shop.example.com/product/9",
    );
    expect(ok.blocked).toBe(false);
    // …but the cart page itself is off-limits.
    const blocked = checkGuardrail(el(`<h2>Your cart</h2>`), "https://shop.example.com/cart");
    expect(blocked.blocked).toBe(true);
  });
});
