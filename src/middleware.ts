/**
 * Middleware helper for tool-dispatch handlers.
 *
 * Tool handlers typically need the current `TenantContext` to authorise,
 * audit and persist a request. Without this helper, every handler signature
 * has to call `getTenantContext()` manually as the first line — boilerplate
 * that obscures the actual handler logic and risks forgetting the call.
 *
 * `withTenantContextHandler` extracts the ctx automatically and passes it
 * as the first argument to the wrapped handler. The handler signature
 * becomes `(ctx, args) => Promise<TResult>` instead of `(args) => Promise<TResult>
 * + getTenantContext() at top`.
 *
 * Throws `NoTenantContextError` if invoked outside `runWithTenantContext`.
 * The error is NOT caught here — the caller (HTTP transport / stdio dispatch)
 * is responsible for surfacing it as a `-32603 internal` JSON-RPC error.
 *
 * @example
 * const listPagesHandler = withTenantContextHandler(
 *   async (ctx, args: { limit: number }) => {
 *     const pages = await db.query(
 *       "SELECT id, title FROM pages WHERE tenant_slug = $1 LIMIT $2",
 *       [ctx.tenantSlug, args.limit],
 *     );
 *     return { pages };
 *   },
 * );
 * // Later, inside the dispatch:
 * await runWithTenantContext(ctx, () => listPagesHandler({ limit: 10 }));
 */

import { getTenantContext } from "./tenant-context.js";
import type { TenantContext } from "./types.js";

export function withTenantContextHandler<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
>(
  handler: (ctx: TenantContext, args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs): Promise<TResult> => {
    // Wrapped in an async function so that a missing ctx surfaces as a
    // rejected Promise<TResult>, not a synchronous throw. The wrapper
    // promises Promise<TResult>, so callers MUST be able to .catch() the
    // NoTenantContextError uniformly.
    const ctx = getTenantContext();
    return handler(ctx, args);
  };
}
