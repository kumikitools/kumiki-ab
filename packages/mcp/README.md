# @kumikitools/mcp

The Kumiki A/B **MCP server** — wraps the control API (ARCHITECTURE.md §3c) so
every route is callable from Claude Code. *The control surface IS the MCP
surface* (§5): each tool maps 1:1 to one control route.

## Status

- **C0 (done):** scaffold + the reference tool `kumiki_create_test`.
- **C1–C8:** one tool per remaining control route + `kumiki_get_results`. Each is
  a replica of `kumiki_create_test`'s shape — see "Adding a tool" below.

## Configure

Env auth only (no per-call credentials):

| Var | Meaning |
|---|---|
| `KUMIKI_API_URL` | Your Worker origin, e.g. `https://kumiki-api.<acct>.workers.dev` |
| `KUMIKI_API_KEY` | The site write key (`ksk_…`), minted by `POST /v1/sites` |

The server refuses to start if either is missing.

## Run from Claude Code

```jsonc
// .mcp.json (or claude mcp add)
{
  "mcpServers": {
    "kumiki": {
      "command": "node",
      "args": ["packages/mcp/dist/index.js"],
      "env": {
        "KUMIKI_API_URL": "https://kumiki-api.<acct>.workers.dev",
        "KUMIKI_API_KEY": "ksk_…"
      }
    }
  }
}
```

`npm run build -w @kumikitools/mcp` first (compiles `src` → `dist`).

## Architecture (the conventions C1–C8 inherit)

```
src/
  config.ts        env auth → KumikiMcpConfig (fail fast)
  api-client.ts    the one HTTP helper: bearer key, JSON, error-mapping
  errors.ts        ApiClientError — preserves the API's stable `code`
  tool-result.ts   toToolResult / toToolError → MCP CallToolResult
  server.ts        assemble McpServer + one register…() per tool
  index.ts         bin: load config → createServer → stdio transport
  tools/
    create-test.ts THE reference tool (C0)
```

A tool is thin: **validate (composed `@kumikitools/schema` primitives) → call the
API via `ApiClient` → return JSON / surface the error `code`.** It never
re-declares a contract type (single source of truth, ARCH §0) and never
re-implements the API's semantic rules — the API owns those and returns
`invalid_body` / `unknown_winner` / `site_not_found` / `invalid_key`, which the
tool passes through unchanged.

### Adding a tool (C1–C8)

Copy `tools/create-test.ts` and swap four things:

1. the arg shape (compose schema primitives + any path params),
2. the route + method (`client.get/patch/put/post`),
3. the body (args minus path params),
4. nothing else — success/error mapping is shared.

Then add one `register…(server, client)` line to `server.ts`.

## Test

```
npm test -w @kumikitools/mcp
```

Covers the two layers every tool inherits: arg validation (composed from the
shared schema) and error mapping (API envelope → tool error, `code` preserved).
End-to-end (tool callable over stdio, creating a real test) is verified against
`wrangler dev` — see the C0 entry in [TASKS.md](../../TASKS.md).
