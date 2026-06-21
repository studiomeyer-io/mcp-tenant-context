# Changelog

All notable changes to `mcp-tenant-context` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Roadmap

- A small published benchmark of the `AsyncLocalStorage` overhead.

## [0.2.0] - 2026-06-21

### Added

- `bindTenantContext(fn)` — snapshot helper that binds a callback to the tenant
  context active at call time, so a listener registered on an `EventEmitter` or
  stream (`stream.on("data", ...)`, `req.on("close", ...)`) still observes the
  context when invoked later, outside the original async scope. Built on Node's
  `AsyncLocalStorage.bind`; preserves the wrapped function's exact parameter and
  return types via a generic (no `any`). This was the v0.2 roadmap item replacing
  the manual `AsyncResource.bind` recipe previously shown in the README.
- Async-context-correctness test suite (`tests/async-boundaries.test.ts`, 20
  tests) pinning context behaviour across `await` chains, `queueMicrotask`,
  `process.nextTick`, `setImmediate`, `setTimeout` (reject path), `setInterval`,
  `Promise.all` / `Promise.race` / `Promise.allSettled`, nested + concurrent
  `runWithTenantContext`, and the *correct absence* of context inside detached
  `EventEmitter` / stream listeners — plus recovery of all of these via
  `bindTenantContext`.

### Changed

- Test suite grows from 27 to 47 tests across 4 files; coverage stays at the
  enforced 100% (statements / branches / functions / lines).

### Security

- Dev-dependency lockfile refreshed to pull in the patched `vite` (via
  `vitest` 4.1.9), clearing the high-severity advisories
  [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff) and
  [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3).
  Dev-only and Windows-specific; no effect on the published runtime (which has
  zero dependencies). `package.json` ranges were unchanged — the caret ranges
  already permitted the fixed versions.

### Compatibility

- Non-breaking: every 0.1.0 export keeps its signature. `bindTenantContext` is
  purely additive.

## [0.1.0] - 2026-05-31

Initial public release.

### Added

- `runWithTenantContext<T>(ctx, fn)` — AsyncLocalStorage wrapper that installs
  `ctx` for `fn` and every awaited child frame. Preserves sync-vs-async return type.
- `getTenantContext()` — returns the current context or throws `NoTenantContextError`.
- `getTenantContextOrUndefined()` — returns `undefined` instead of throwing.
- `withTenantContextHandler<TArgs, TResult>(handler)` — middleware helper that
  extracts the ctx and passes it as the first handler argument.
- `oauthActor(email)`, `apiKeyActor(tenantSlug)`, `anonymousActor()` — actor
  constructors for the three `ActorSource` paths. `oauthActor` derives a display
  name defensively: malformed input (no `@`, empty or separator-only local part)
  is returned unchanged, and the derived name is length-capped so a pathological
  local part cannot inflate the in-memory context.
- `TenantContext` type — `{ tenantSlug, actor, traceId?, sessionId? }`.
- `ActorIdentity` type — `{ email, name, source }`.
- `ActorSource` type — `"oauth" | "api_key" | "anonymous"`.
- `NoTenantContextError` class — specific, catchable error subclass.
- Vitest test suite (27 tests across 3 files) covering nested, sibling-concurrent,
  async-iterator and detached-`setTimeout` propagation, the actor helpers
  (including pathological-email inputs), the middleware, and the error class.
- TypeScript strict build to `dist/` with `.d.ts` declarations.

### Notes

- Zero runtime dependencies (Node `async_hooks` stdlib only).
- Node 22+ required.
- The library does **not** validate `tenantSlug` or `email` — that is a consumer
  responsibility (see the README "Consumer responsibilities" section).
