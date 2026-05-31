import { describe, it, expect } from "vitest";
import {
  runWithTenantContext,
  withTenantContextHandler,
  oauthActor,
  NoTenantContextError,
  type TenantContext,
} from "../src/index.js";

function ctx(tenantSlug: string): TenantContext {
  return { tenantSlug, actor: oauthActor("ada@acme.example") };
}

describe("withTenantContextHandler", () => {
  it("forwards the current ctx as the first argument to the handler", async () => {
    const handler = withTenantContextHandler(
      async (c: TenantContext, args: { n: number }) => {
        return { slug: c.tenantSlug, doubled: args.n * 2 };
      },
    );
    const out = await runWithTenantContext(ctx("acme"), () =>
      handler({ n: 21 }),
    );
    expect(out).toEqual({ slug: "acme", doubled: 42 });
  });

  it("throws NoTenantContextError when invoked outside runWithTenantContext", async () => {
    const handler = withTenantContextHandler(
      async (_c: TenantContext, _args: { n: number }) => {
        return "unreached";
      },
    );
    await expect(handler({ n: 1 })).rejects.toBeInstanceOf(
      NoTenantContextError,
    );
  });

  it("propagates errors thrown by the inner handler unchanged", async () => {
    const handler = withTenantContextHandler(
      async (_c: TenantContext, _args: Record<string, never>) => {
        throw new RangeError("boom");
      },
    );
    await expect(
      runWithTenantContext(ctx("acme"), () => handler({})),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("supports parallel handler invocations with different ctxs", async () => {
    const handler = withTenantContextHandler(
      async (c: TenantContext, _args: Record<string, never>) => c.tenantSlug,
    );
    const [a, b] = await Promise.all([
      runWithTenantContext(ctx("alpha"), () => handler({})),
      runWithTenantContext(ctx("bravo"), () => handler({})),
    ]);
    expect([a, b].sort()).toEqual(["alpha", "bravo"]);
  });

  it("respects the typed args generic", async () => {
    interface ListArgs {
      limit: number;
      cursor?: string;
    }
    const handler = withTenantContextHandler(
      async (_c: TenantContext, args: ListArgs) => {
        return args.limit;
      },
    );
    const v = await runWithTenantContext(ctx("acme"), () =>
      handler({ limit: 25 }),
    );
    expect(v).toBe(25);
  });
});
