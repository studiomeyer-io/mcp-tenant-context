/**
 * AsyncLocalStorage-backed tenant-context propagation.
 *
 * The storage instance is module-local: importing `mcp-tenant-context` from
 * multiple modules within the same Node process SHARES the same store. This
 * is the intended behaviour — tenant context is process-wide.
 *
 * Edge cases covered by the test suite:
 *   - Nested runWithTenantContext: inner ctx overrides for its scope, outer
 *     is restored on resume.
 *   - Async-iterator passthrough: ctx survives `for await` boundaries.
 *   - setTimeout callbacks: ctx survives detached timer callbacks (AsyncLocalStorage
 *     guarantees this via async_hooks).
 *   - Sibling concurrent calls: parallel `Promise.all([runWithTenantContext(a), runWithTenantContext(b)])`
 *     do not bleed into each other.
 *   - bindTenantContext: snapshots the current context so a listener registered
 *     on an EventEmitter / stream still observes it when invoked later, outside
 *     the original async scope.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import {
  type ActorIdentity,
  type TenantContext,
  NoTenantContextError,
} from "./types.js";

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Any callable. Used as the type constraint for {@link bindTenantContext} so
 * the exact parameter and return types of the bound function are preserved
 * end-to-end without resorting to `any`.
 */
type AnyFunction = (...args: never[]) => unknown;

/**
 * Run `fn` with `ctx` installed as the current tenant context. Every
 * AsyncLocalStorage-aware read inside `fn` (and any awaited child frame)
 * will observe this context.
 *
 * The function preserves the synchronous-vs-async return-type of `fn`:
 *   - If `fn` returns `T` synchronously, this returns `T` synchronously.
 *   - If `fn` returns `Promise<T>`, this returns `Promise<T>`.
 *
 * @example
 * await runWithTenantContext(
 *   { tenantSlug: "acme", actor: oauthActor("ada@acme.example") },
 *   async () => { await handler(args); },
 * );
 */
export function runWithTenantContext<T>(
  ctx: TenantContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Returns the current tenant context.
 *
 * @throws {NoTenantContextError} when called outside `runWithTenantContext`.
 *
 * Use `getTenantContextOrUndefined()` if your handler legitimately runs
 * without a tenant (health-check, /metrics, anonymous public reads).
 */
export function getTenantContext(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new NoTenantContextError();
  }
  return ctx;
}

/**
 * Returns the current tenant context or `undefined` if none is active.
 *
 * Non-throwing counterpart of `getTenantContext()`. Useful for code paths
 * that read tenant info opportunistically (e.g. structured logging
 * decorators that add tenant_slug to log records when available).
 */
export function getTenantContextOrUndefined(): TenantContext | undefined {
  return storage.getStore();
}

/**
 * Bind `fn` to the tenant context that is active *right now*, returning a new
 * function with the identical signature. However the bound function is later
 * invoked — synchronously, from a timer, or from an `EventEmitter` / stream
 * listener registered outside any tenant scope — it runs with the captured
 * context restored, so `getTenantContext()` inside it resolves instead of
 * throwing.
 *
 * This closes the one gap `AsyncLocalStorage` does not cover automatically: a
 * callback attached in a *different* async context (the classic
 * `stream.on("data", ...)` / `req.on("close", ...)` case — see the README
 * "Context loss across callbacks and event emitters"). Capture the context at
 * registration time:
 *
 * @example
 * runWithTenantContext(ctx, () => {
 *   // Registered now → bound to `ctx`, even though `emit` happens later.
 *   stream.on("data", bindTenantContext((chunk: Buffer) => {
 *     const { tenantSlug } = getTenantContext(); // resolves to ctx
 *     audit(tenantSlug, chunk.length);
 *   }));
 * });
 *
 * Arguments passed to the bound function are forwarded unchanged, and the
 * return value is passed through. If there is no active context when
 * `bindTenantContext` is called, the snapshot is simply empty — invoking the
 * bound function then behaves exactly as if it were never bound (i.e.
 * `getTenantContext()` throws), which is the same behaviour as not binding at
 * all.
 *
 * Note: this binds the *whole* async context (all `AsyncLocalStorage`
 * instances), not only this library's store — that is how Node's primitive
 * works and is what you want, since a single callback usually needs every
 * ambient context (tenant, trace, logger) restored together.
 */
export function bindTenantContext<F extends AnyFunction>(fn: F): F {
  return AsyncLocalStorage.bind(fn);
}

/**
 * Build an OAuth-backed actor. `email` MUST be the OAuth-verified email.
 *
 * The display name is derived from the local part by splitting on `._-`
 * and title-casing — e.g. `ada.lovelace@acme.example` -> "Ada Lovelace".
 *
 * Robust against malformed input: an address with no `@`, or a local part
 * that is empty or made only of separators, is returned unchanged as the
 * name (no name is invented from a non-email shape). The derived name is
 * capped at {@link MAX_DERIVED_NAME_LOCAL} characters so a pathological
 * local part cannot inflate the in-memory context.
 */
export function oauthActor(email: string): ActorIdentity {
  return { email, name: deriveName(email), source: "oauth" };
}

/**
 * Build a synthetic actor for Bearer-API-key requests where no human user
 * is attached. The synthetic email is deterministic
 * (`service-account@<tenantSlug>.invalid`) so audit-log entries stay readable.
 *
 * `.invalid` is the RFC 2606 reserved TLD: the address is guaranteed to be
 * non-resolvable, so it can never collide with a real mailbox.
 */
export function apiKeyActor(tenantSlug: string): ActorIdentity {
  const email = `service-account@${tenantSlug}.invalid`;
  return { email, name: `${tenantSlug} service-account`, source: "api_key" };
}

/**
 * Build an anonymous actor. `email` is empty; only used for unauthenticated
 * public-read endpoints. Most tools should reject anonymous actors at the
 * handler level (`if (ctx.actor.source === "anonymous") throw ...`).
 */
export function anonymousActor(): ActorIdentity {
  return { email: "", name: "anonymous", source: "anonymous" };
}

/** Upper bound on the local part used to derive a display name. */
const MAX_DERIVED_NAME_LOCAL = 64;

function deriveName(email: string): string {
  const at = email.indexOf("@");
  // No "@": not an email shape — return the raw input rather than inventing
  // a display name from it.
  if (at === -1) {
    return email;
  }
  const local = email.slice(0, at).slice(0, MAX_DERIVED_NAME_LOCAL);
  const normalised = local
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Empty or separator-only local part → fall back to the raw input.
  if (normalised.length === 0) {
    return email;
  }
  return normalised.replace(/\b\w/g, (c) => c.toUpperCase());
}
