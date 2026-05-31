# Changelog

All notable changes to `mcp-tenant-context` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Roadmap (v0.2)

- `bindTenantContext()` / snapshot helper to carry the context across detached
  callbacks and `EventEmitter` listeners (see README "Context loss").
- A small published benchmark of the `AsyncLocalStorage` overhead.

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
