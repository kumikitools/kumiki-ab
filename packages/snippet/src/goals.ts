// Declarative goal evaluators (D3). Wires URL/click/form listeners that fire
// conversion beacons when a site-level goal is met. Design: one delegated
// listener per event type (not per goal), dedup for URL goals, fail-open.
import type { Goal } from "@kumikitools/schema";
import { matchesUrl } from "./urlmatch";
import type { Beacon } from "./beacon";

/**
 * Install listeners for all site-level goals. Fires `beacon.enqueueConversion`
 * whenever a goal condition is satisfied.
 *
 * - URL goals: checked on load and on SPA navigation (history patch + popstate).
 *   Deduped per (goalId, href) so a single page-visit only fires once per goal.
 * - Click goals: one capture-phase delegated click listener on `doc`.
 * - Form goals: one capture-phase delegated submit listener on `doc`.
 *
 * Never throws — any evaluator failure is swallowed so the page is unaffected.
 */
export function initGoals(
  goals: Goal[],
  visitorId: string,
  beacon: Beacon,
  win: Window,
  doc: Document,
): void {
  if (!goals.length) return;

  try {
    const urlGoals = goals.filter((g): g is Extract<Goal, { type: "url" }> => g.type === "url");
    const clickGoals = goals.filter((g): g is Extract<Goal, { type: "click" }> => g.type === "click");
    const formGoals = goals.filter((g): g is Extract<Goal, { type: "form" }> => g.type === "form");

    // ── URL goals ─────────────────────────────────────────────────────────
    if (urlGoals.length > 0) {
      const fired = new Set<string>(); // (goalId + "\0" + href)

      function checkUrlGoals(): void {
        try {
          const href = win.location?.href ?? "";
          for (const goal of urlGoals) {
            const key = `${goal.id}\0${href}`;
            if (fired.has(key)) continue;
            if (matchesUrl(goal.targeting, href)) {
              fired.add(key);
              beacon.enqueueConversion(goal.id, visitorId, { value: goal.value });
            }
          }
        } catch {}
      }

      checkUrlGoals(); // Initial check on bootstrap

      try {
        // SPA nav: patch history methods + listen for popstate.
        const origPush = win.history.pushState.bind(win.history);
        win.history.pushState = (...args: Parameters<typeof history.pushState>) => {
          origPush(...args);
          checkUrlGoals();
        };
        const origReplace = win.history.replaceState.bind(win.history);
        win.history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
          origReplace(...args);
          checkUrlGoals();
        };
        win.addEventListener("popstate", checkUrlGoals);
      } catch {}
    }

    // ── Click goals ───────────────────────────────────────────────────────
    if (clickGoals.length > 0) {
      try {
        doc.addEventListener(
          "click",
          (e) => {
            const target = e.target as Element | null;
            if (!target) return;
            for (const goal of clickGoals) {
              try {
                if (target.closest(goal.selector)) {
                  beacon.enqueueConversion(goal.id, visitorId, { value: goal.value });
                }
              } catch {}
            }
          },
          true, // capture phase so we see the event before any stopPropagation
        );
      } catch {}
    }

    // ── Form goals ────────────────────────────────────────────────────────
    if (formGoals.length > 0) {
      try {
        doc.addEventListener(
          "submit",
          (e) => {
            const form = e.target as Element | null;
            if (!form) return;
            for (const goal of formGoals) {
              try {
                if (form.matches(goal.selector)) {
                  beacon.enqueueConversion(goal.id, visitorId, { value: goal.value });
                }
              } catch {}
            }
          },
          true,
        );
      } catch {}
    }
  } catch {}
}
