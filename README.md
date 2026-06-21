<!-- studiomeyer-mcp-stack-banner:start -->
> **Part of the [StudioMeyer MCP Stack](https://studiomeyer.io)** — Built in Mallorca 🌴 · ⭐ if you use it
<!-- studiomeyer-mcp-stack-banner:end -->

# mcp-tenant-context

<!-- badges -->
[![CI](https://img.shields.io/github/actions/workflow/status/studiomeyer-io/mcp-tenant-context/ci.yml?branch=main&style=flat-square&logo=githubactions&logoColor=white&label=CI)](https://github.com/studiomeyer-io/mcp-tenant-context/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/mcp-tenant-context?style=flat-square&color=cb3837&logo=npm&label=npm)](https://www.npmjs.com/package/mcp-tenant-context)
[![npm downloads](https://img.shields.io/npm/dm/mcp-tenant-context?style=flat-square&color=cb3837&logo=npm&label=installs%2Fmo)](https://www.npmjs.com/package/mcp-tenant-context)
![License](https://img.shields.io/github/license/studiomeyer-io/mcp-tenant-context?style=flat-square&color=22c55e&label=license)
![Last commit](https://img.shields.io/github/last-commit/studiomeyer-io/mcp-tenant-context?style=flat-square&color=88c0d0&label=updated)
![GitHub stars](https://img.shields.io/github/stars/studiomeyer-io/mcp-tenant-context?style=flat-square&color=ffd700&logo=github&label=stars)
<!-- /badges -->

Propagate a per-request **tenant + actor** identity through your handler stack
via `AsyncLocalStorage` — so `tenantSlug` and the request actor stay out of
every function signature. Zero runtime dependencies, just the Node stdlib.

**Node:** 22+ · **License:** MIT · **Type:** library (no server, no CLI)

## A note from us

We have been building tools and systems for ourselves for the past two years.
This repo is small and has few stars not because it is new, but because we only
just decided to share what we had already built. The code is real, it runs in
production, and issues get answered.

We love building things and sharing them. We do not love growth hacks or chasing
stars. So this repo is small. Judge it by the code. If it helps you, a star, a
test, or an issue helps us. If you build something with it, tell us at
hello@studiomeyer.io — that genuinely makes our day.

From a small studio in Palma de Mallorca.

## Why this exists

Every multi-tenant server has to thread two pieces of per-request identity
through its handler stack:

- `tenantSlug` — which tenant the request belongs to. It drives every scoped DB
  query (`WHERE tenant_slug = $1`) and is the core of cross-tenant isolation.
- `actor` — the human (OAuth user) or service principal (API key) that triggered
  the request. It drives audit-log entries and write attribution.

Passing these through every handler signature is boilerplate, and a forgotten
parameter is a silent bug. `AsyncLocalStorage` keeps the surface clean: set the
context once at the entry point, read it anywhere in the call stack. This library
is that pattern, packaged — about 115 lines, no dependencies, fully typed.

It is written with MCP servers in mind (the `TenantContext` carries an optional
`sessionId` matching the `mcp-session-id` header), but nothing here is
MCP-specific — it works for any request-scoped Node service.

## Install

```bash
npm install mcp-tenant-context
```

Requires Node 22+.

## Quickstart

```typescript
import {
  runWithTenantContext,
  getTenantContext,
  oauthActor,
} from "mcp-tenant-context";

// At the transport boundary — wrap every dispatch in a tenant context.
app.post("/mcp", async (req, res) => {
  const slug = await authenticateBearer(req);
  const email = await verifyOAuth(req);
  await runWithTenantContext(
    { tenantSlug: slug, actor: oauthActor(email) },
    async () => {
      const result = await dispatchTool(req.body);
      res.json(result);
    },
  );
});

// Anywhere inside a tool handler — no ctx threading needed.
async function listPages(args: { limit: number }) {
  const ctx = getTenantContext(); // throws if no ctx is active
  return db.query(
    "SELECT * FROM pages WHERE tenant_slug = $1 LIMIT $2",
    [ctx.tenantSlug, args.limit],
  );
}
```

## Public API

| Export | Purpose |
|--------|---------|
| `runWithTenantContext<T>(ctx, fn)` | Run `fn` with `ctx` installed. Preserves sync/async return type. |
| `getTenantContext()` | Current ctx, or throws `NoTenantContextError`. |
| `getTenantContextOrUndefined()` | Current ctx, or `undefined`. |
| `bindTenantContext<F>(fn)` | Snapshot the active ctx onto `fn` so detached `EventEmitter`/stream callbacks keep it. Same signature in, same out. |
| `withTenantContextHandler<TArgs, TResult>(handler)` | Middleware that extracts ctx and passes it as the first arg. |
| `oauthActor(email)` | OAuth-backed actor. Display name derived from the email local part. |
| `apiKeyActor(tenantSlug)` | Synthetic `service-account@<slug>.invalid` actor (RFC 2606 reserved TLD). |
| `anonymousActor()` | Empty-email actor for unauthenticated paths. |
| `TenantContext` (type) | `{ tenantSlug, actor, traceId?, sessionId? }`. |
| `ActorIdentity` (type) | `{ email, name, source }`. |
| `ActorSource` (type) | `"oauth" \| "api_key" \| "anonymous"`. |
| `NoTenantContextError` (class) | Specific, catchable error subclass. |

## Middleware

`withTenantContextHandler` factors out the `getTenantContext()` boilerplate:

```typescript
import { withTenantContextHandler } from "mcp-tenant-context";

export const listPages = withTenantContextHandler(
  async (ctx, args: { limit: number }) => {
    return db.query(
      "SELECT * FROM pages WHERE tenant_slug = $1 LIMIT $2",
      [ctx.tenantSlug, args.limit],
    );
  },
);

// Dispatch:
await runWithTenantContext(ctx, () => listPages({ limit: 10 }));
```

A handler invoked outside `runWithTenantContext` rejects with
`NoTenantContextError` (as a rejected promise, so every caller can `.catch()`
it uniformly).

## Consumer responsibilities

This library **does not validate or sanitise its inputs** — by design, so it
stays generic. The caller owns the security-relevant parts:

- **Validate `tenantSlug`** before building a context (non-empty, expected
  charset, e.g. `^[a-z0-9][a-z0-9-]{0,62}$`). An empty or attacker-controlled
  slug handed to `WHERE tenant_slug = $1` is a cross-tenant risk.
- **Parameterise SQL** — `tenantSlug` is a plain string, never interpolate it.
- **Verify `email`** in your identity layer and lowercase it before
  `oauthActor(email)`.
- **Reject anonymous actors** at the handler level where a tenant is required.

The library guarantees one thing: contexts do not bleed between concurrent
scopes. Everything above the context is yours.

## Context loss across callbacks and event emitters

`AsyncLocalStorage` follows `async`/`await`, promises, `setTimeout`,
`setInterval`, `setImmediate`, `process.nextTick`, `queueMicrotask` and the
`Promise.all` / `race` / `allSettled` combinators automatically (all covered by
the test suite). It does **not** follow a callback registered in a *different*
async context — the classic case is an `EventEmitter` listener
(`stream.on("data", ...)`, `req.on("close", ...)`) attached outside the tenant
scope. Inside such a callback `getTenantContext()` throws.

For that case, bind the callback to the current context at registration time
with `bindTenantContext`:

```typescript
import { runWithTenantContext, bindTenantContext, getTenantContext } from "mcp-tenant-context";

runWithTenantContext(ctx, () => {
  // Captured now → still resolves when `data` fires later, outside the scope.
  stream.on("data", bindTenantContext((chunk: Buffer) => {
    const { tenantSlug } = getTenantContext(); // resolves to ctx
    audit(tenantSlug, chunk.length);
  }));
});
```

`bindTenantContext(fn)` returns a function with the **same signature** as `fn`
(arguments and return value pass through unchanged) and snapshots the whole
ambient async context, so tenant, trace and any other `AsyncLocalStorage` are
restored together. It is built on Node's `AsyncLocalStorage.bind`. If there is
no active context when you bind, the bound function behaves exactly like the
unbound one (so `getTenantContext()` still throws) — binding is never harmful.

The context still does **not** propagate into `worker_threads` — a spawned
worker starts with an empty store by design. Pass `tenantSlug` explicitly across
the worker boundary.

## Performance

`AsyncLocalStorage` adds a small, constant per-`await` bookkeeping cost. For a
handler that does any real work (a DB round-trip, an LLM call) it is negligible
— the latency is dominated by the I/O, not the context lookup. Node documents
the implementation as "performant and memory safe". Only measure it if you have
an extremely hot, allocation-sensitive path.

## Module instance

The store is a module-level singleton: every import of `mcp-tenant-context` in
the same process shares one store (intended — the context is process-wide). If
your dependency tree ends up with two *different* installed copies of this
package they will not share a store, so keep a single version (`npm dedupe`)
when several of your dependencies use it.

## Edge cases covered by the test suite

- Nested `runWithTenantContext` — inner overrides, outer is restored on resume,
  including after an `await` and across concurrent child scopes.
- Sibling concurrent runs — no bleed between parallel contexts.
- Async-iterator passthrough — ctx survives `for await` boundaries.
- Every timer + microtask boundary — `setTimeout` (resolve *and* reject path),
  `setInterval`, `setImmediate`, `process.nextTick`, `queueMicrotask`.
- Promise combinators — `Promise.all`, `Promise.race`, `Promise.allSettled`
  keep ctx in each branch and after the join.
- Detached `EventEmitter` / stream listeners — ctx is *correctly absent* (the
  one boundary `AsyncLocalStorage` cannot follow), and `getTenantContext()`
  throws there; `bindTenantContext` restores it, even after `run()` has exited
  and even when emitted from inside a different live context.
- Synchronous-vs-async `fn` return type — preserved.
- Optional `traceId` + `sessionId` fields.
- `oauthActor` with pathological input: empty local part (`@host`), no `@` at
  all, separator-only local part, and an over-long local part (the derived name
  is capped, the email is preserved verbatim) — each returns a safe,
  non-throwing value.

47 tests across 4 files.

## Versioning

Strict [SemVer](https://semver.org/). No breaking change without a major bump
and a migration note in [`CHANGELOG.md`](./CHANGELOG.md). Pin with a caret
(`"mcp-tenant-context": "^0.2.0"`).

## Related

Part of the StudioMeyer MCP stack — natural co-installs when building a
multi-tenant MCP server with defense-in-depth:

- [`mcp-tenant-pair`](https://github.com/studiomeyer-io/mcp-tenant-pair) — multi-user tenancy (couples, families, small groups) for consumer MCP servers.
- [`mcp-stdio-shellguard`](https://github.com/studiomeyer-io/mcp-stdio-shellguard) — default-deny guard for `exec`/`spawn` in MCP servers.
- [`mcp-rce-guard`](https://github.com/studiomeyer-io/mcp-rce-guard) — process-isolation + CVE-replay defense for MCP subprocesses.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). Security
reports go through the process in [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © Matthias Meyer (StudioMeyer)
