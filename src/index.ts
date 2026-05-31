/**
 * mcp-tenant-context — Public API.
 *
 * Tenant + actor identity propagation via AsyncLocalStorage, so MCP servers
 * (and any request-scoped Node service) can keep `tenantSlug` and `actor`
 * out of every handler signature.
 *
 * @packageDocumentation
 */

export {
  runWithTenantContext,
  getTenantContext,
  getTenantContextOrUndefined,
  oauthActor,
  apiKeyActor,
  anonymousActor,
} from "./tenant-context.js";

export { withTenantContextHandler } from "./middleware.js";

export {
  type TenantContext,
  type ActorIdentity,
  type ActorSource,
  NoTenantContextError,
} from "./types.js";
