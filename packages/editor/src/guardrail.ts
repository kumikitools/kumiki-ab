// Checkout / payment guardrail (ARCH §3 guardrails, lines ~186–188: "never touch
// checkout/payment selectors"). Production storefronts are high-stakes — a variant
// that mutates a price, a "Buy" button, or a card-input field is the one change
// that can cost real money or break a purchase. The overlay REFUSES to pick such
// elements (the snippet has no equivalent guard, so the editor must not author
// the change in the first place).
//
// Detection is intentionally broad and fail-safe: if any signal says "this looks
// like checkout/payment", we block. False positives (blocking a safe element) are
// acceptable; false negatives (authoring a payment change) are not.

/** Why a pick was blocked, for the overlay to explain to the user. */
export interface GuardrailVerdict {
  blocked: boolean;
  reason?: string;
}

// URL path fragments that indicate a checkout/payment flow.
const CHECKOUT_URL = /(?:^|\/)(?:checkout|payment|pay|billing|order|cart|purchase|kessai|kounyu)(?:\/|$|\?)|決済|購入|支払|お会計|カート/i;

// Attribute/text signals on or around the element.
const PAYMENT_TOKENS =
  /\b(?:checkout|payment|pay-?now|billing|credit-?card|card-?number|cardnumber|cvc|cvv|expiry|stripe|paypal|braintree|adyen|square|kessai)\b|決済|支払|購入手続|カード番号|有効期限|セキュリティコード/i;

// Sensitive autocomplete tokens (the platform's own payment hints).
const PAYMENT_AUTOCOMPLETE = /\bcc-(?:number|exp|csc|name)\b|\bcc-/i;

function attrHaystack(el: Element): string {
  const parts: string[] = [el.tagName.toLowerCase()];
  for (const name of ["id", "class", "name", "placeholder", "aria-label", "title", "data-testid", "autocomplete"]) {
    const v = el.getAttribute(name);
    if (v) parts.push(v);
  }
  return parts.join(" ");
}

/** True if `el` or any ancestor is a payment-bearing form/region. */
function inPaymentRegion(el: Element): boolean {
  let node: Element | null = el;
  let hops = 0;
  while (node && hops < 12) {
    const hay = attrHaystack(node);
    if (PAYMENT_TOKENS.test(hay) || PAYMENT_AUTOCOMPLETE.test(hay)) return true;
    // A form containing a card-ish input is a payment form.
    if (node.tagName === "FORM" && node.querySelector(
      'input[autocomplete^="cc-"], input[name*="card" i], input[name*="cvc" i], input[name*="cvv" i]',
    )) {
      return true;
    }
    node = node.parentElement;
    hops++;
  }
  return false;
}

/**
 * Decide whether the picked element may be edited. Pass the current page URL so
 * we can block the entire checkout flow regardless of the specific element.
 */
export function checkGuardrail(el: Element, url: string): GuardrailVerdict {
  if (CHECKOUT_URL.test(url)) {
    return {
      blocked: true,
      reason:
        "This page looks like a checkout/payment flow. Kumiki never edits checkout or payment elements (ARCH §3 guardrail). Pick on a non-checkout page.",
    };
  }
  const hay = attrHaystack(el);
  if (PAYMENT_TOKENS.test(hay) || PAYMENT_AUTOCOMPLETE.test(hay)) {
    return {
      blocked: true,
      reason:
        "This element looks payment/checkout-related. Kumiki never edits payment elements (ARCH §3 guardrail).",
    };
  }
  if (inPaymentRegion(el)) {
    return {
      blocked: true,
      reason:
        "This element is inside a payment/checkout region. Kumiki never edits inside payment forms (ARCH §3 guardrail).",
    };
  }
  return { blocked: false };
}
