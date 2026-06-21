// GET /editor — serves the visual-editor IIFE (ARCH §9.7). The bookmarklet on
// the user's live page injects `<script src="<dashboard-origin>/editor">`, so
// this must be a same-origin asset of the dashboard. The bytes are embedded at
// build time (src/lib/editor-asset.ts) because the Worker has no filesystem.
import { EDITOR_JS } from "@/lib/editor-asset";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(EDITOR_JS, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // The script is a public, MIT, config-free bundle — safe to cache hard.
      "cache-control": "public, max-age=3600",
    },
  });
}
