/**
 * Type definitions + error classes for tenant-context propagation.
 *
 * One surface covers both common server shapes:
 *   - multi-tenant: a tenant slug per request + an actor with source
 *     "oauth" | "api_key"
 *   - single-tenant: a constant tenant slug + an actor with source
 *     "oauth" | "anonymous"
 *
 * The library standardises on `tenantSlug` as the tenant identifier and
 * supports all three `ActorSource` values, so a server can adopt it without
 * widening the union later.
 */

/**
 * Origin of the actor identity. Drives which fields are reliable:
 *   - "oauth":     email is OAuth-verified, name is derived/display
 *   - "api_key":   email is a deterministic synthetic (service-account@...)
 *   - "anonymous": email may be empty; only used for unauthenticated public reads
 */
export type ActorSource = "oauth" | "api_key" | "anonymous";

/**
 * The identity of the human (or service principal) that triggered the current
 * request. Carried alongside `TenantContext` so audit-log and git-commit
 * helpers can attribute writes without re-threading auth state.
 */
export interface ActorIdentity {
  /**
   * Email address (real for OAuth, synthetic for API-key, may be empty
   * for anonymous). Always a string for ergonomics — use `source` to
   * decide trust level, not `email !== ""`.
   */
  readonly email: string;
  /** Display name derived from email (e.g. "Ada Lovelace"). */
  readonly name: string;
  /** Auth path that produced this actor. */
  readonly source: ActorSource;
}

/**
 * Per-request context propagated via AsyncLocalStorage.
 *
 * `tenantSlug` is the canonical tenant identifier (e.g. "acme", "globex").
 * Servers MAY use it directly as the DB `tenant_slug` column value — the
 * field name is deliberately neutral so projects with different tenant
 * terminology can reuse the library without re-mapping.
 */
export interface TenantContext {
  readonly tenantSlug: string;
  readonly actor: ActorIdentity;
  /** Optional distributed-trace correlation id (OpenTelemetry-style). */
  readonly traceId?: string;
  /** Optional MCP session id (matches the `mcp-session-id` header). */
  readonly sessionId?: string;
}

/**
 * Thrown by `getTenantContext()` when called outside `runWithTenantContext`.
 *
 * Specific class so tool handlers that legitimately tolerate missing context
 * (e.g. health-check endpoints) can `catch (e) { if (e instanceof NoTenantContextError) ... }`
 * without swallowing other errors.
 */
export class NoTenantContextError extends Error {
  override readonly name = "NoTenantContextError";
  constructor(message?: string) {
    super(
      message ??
        "TENANT_CONTEXT_MISSING: getTenantContext() called outside runWithTenantContext(). " +
          "Wrap the dispatch in runWithTenantContext(ctx, fn) before invoking tool handlers.",
    );
    // Restore prototype chain (needed when targeting ES5/ES2015 with class extends Error)
    Object.setPrototypeOf(this, NoTenantContextError.prototype);
  }
}
