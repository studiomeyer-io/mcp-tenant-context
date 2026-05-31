# Security Policy

## Scope

`mcp-tenant-context` is a small, dependency-free library that propagates a
per-request `TenantContext` (tenant slug + actor identity) through an
`AsyncLocalStorage`. It performs no network, filesystem, subprocess, crypto or
database operations. Its security relevance is narrow but real: it is the
primitive that downstream servers build cross-tenant isolation on top of.

The property this library guarantees is **context isolation**: two concurrent
`runWithTenantContext` scopes never observe each other's context. That property
is covered by the test suite (nested, sibling-concurrent, async-iterator and
detached-timer cases). A bug that breaks it — for example, one request reading
another request's `tenantSlug` — is a security issue and in scope for this policy.

## Consumer responsibilities (not handled by this library)

The library deliberately does **not** validate or sanitise its inputs. The
following are the consumer's responsibility, and getting them wrong is the most
likely way to turn a correct library into a vulnerable system:

- **Validate `tenantSlug`** before constructing a context (non-empty, expected
  charset, e.g. `^[a-z0-9][a-z0-9-]{0,62}$`). An empty or attacker-controlled
  slug fed straight into `WHERE tenant_slug = $1` is a cross-tenant risk.
- **Parameterise SQL.** `tenantSlug` is a plain string; never interpolate it.
- **Verify `email`** out of band (it comes from your OAuth/identity layer) and
  lowercase it before building an actor.
- **Reject anonymous actors** at the handler level where a tenant is required.

## Reporting a vulnerability

Please report suspected vulnerabilities privately. Do **not** open a public
issue for a security report.

- Email: **security@studiomeyer.io** (or hello@studiomeyer.io)
- Preferred: GitHub private vulnerability reporting ("Report a vulnerability"
  on the repository Security tab).

Include a description, affected version, and a minimal reproduction if possible.
We aim to acknowledge within 5 working days and to coordinate a fix and
disclosure timeline with you. We credit reporters who want credit.

## Supported versions

The latest `0.x` release on npm receives security fixes. Pre-1.0, fixes ship as
patch releases against the most recent minor.
