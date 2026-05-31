import { describe, it, expect } from "vitest";
import {
  runWithTenantContext,
  getTenantContext,
  getTenantContextOrUndefined,
  oauthActor,
  apiKeyActor,
  anonymousActor,
  type TenantContext,
} from "../src/index.js";

function ctx(tenantSlug: string, email = "ada@acme.example"): TenantContext {
  return { tenantSlug, actor: oauthActor(email) };
}

describe("runWithTenantContext", () => {
  it("propagates ctx to a synchronous fn", () => {
    const result = runWithTenantContext(ctx("acme"), () => {
      return getTenantContext().tenantSlug;
    });
    expect(result).toBe("acme");
  });

  it("propagates ctx to an async fn across await boundaries", async () => {
    const result = await runWithTenantContext(ctx("acme"), async () => {
      await new Promise((r) => setTimeout(r, 1));
      return getTenantContext().tenantSlug;
    });
    expect(result).toBe("acme");
  });

  it("nested run overrides inner scope, outer survives resume", async () => {
    await runWithTenantContext(ctx("outer"), async () => {
      expect(getTenantContext().tenantSlug).toBe("outer");
      await runWithTenantContext(ctx("inner"), async () => {
        expect(getTenantContext().tenantSlug).toBe("inner");
      });
      // After the inner scope exits, the outer ctx is restored
      expect(getTenantContext().tenantSlug).toBe("outer");
    });
  });

  it("does not bleed between sibling concurrent runs", async () => {
    const seen: string[] = [];
    await Promise.all([
      runWithTenantContext(ctx("alpha"), async () => {
        await new Promise((r) => setTimeout(r, 5));
        seen.push(getTenantContext().tenantSlug);
      }),
      runWithTenantContext(ctx("bravo"), async () => {
        await new Promise((r) => setTimeout(r, 1));
        seen.push(getTenantContext().tenantSlug);
      }),
    ]);
    expect(seen.sort()).toEqual(["alpha", "bravo"]);
  });

  it("ctx survives setTimeout detached callback", async () => {
    const got = await runWithTenantContext(ctx("acme"), () => {
      return new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve(getTenantContext().tenantSlug);
        }, 1);
      });
    });
    expect(got).toBe("acme");
  });

  it("ctx survives async-iterator passthrough", async () => {
    async function* gen(): AsyncGenerator<string> {
      yield getTenantContext().tenantSlug;
      await new Promise((r) => setTimeout(r, 1));
      yield getTenantContext().tenantSlug;
    }
    const collected: string[] = [];
    await runWithTenantContext(ctx("acme"), async () => {
      for await (const slug of gen()) {
        collected.push(slug);
      }
    });
    expect(collected).toEqual(["acme", "acme"]);
  });

  it("preserves synchronous return type when fn is sync", () => {
    const v = runWithTenantContext(ctx("acme"), () => 42);
    expect(v).toBe(42);
  });

  it("supports optional traceId + sessionId in ctx", () => {
    const c: TenantContext = {
      tenantSlug: "acme",
      actor: oauthActor("ada@acme.example"),
      traceId: "trace-abc",
      sessionId: "session-xyz",
    };
    runWithTenantContext(c, () => {
      const got = getTenantContext();
      expect(got.traceId).toBe("trace-abc");
      expect(got.sessionId).toBe("session-xyz");
    });
  });
});

describe("actor helpers", () => {
  it("oauthActor derives display name from email", () => {
    const a = oauthActor("ada.lovelace@acme.example");
    expect(a.email).toBe("ada.lovelace@acme.example");
    expect(a.name).toBe("Ada Lovelace");
    expect(a.source).toBe("oauth");
  });

  it("oauthActor handles underscore + dash separators", () => {
    expect(oauthActor("first_last@x.com").name).toBe("First Last");
    expect(oauthActor("first-last@x.com").name).toBe("First Last");
  });

  it("oauthActor falls back to email when local part is empty", () => {
    // Pathological input — should not crash, returns the input
    const a = oauthActor("@x.com");
    expect(a.name).toBe("@x.com");
  });

  it("oauthActor returns input unchanged when there is no @ (not an email)", () => {
    // No "@" → not an email shape; return the raw string, do not invent a name.
    expect(oauthActor("notanemailaddress").name).toBe("notanemailaddress");
  });

  it("oauthActor returns input unchanged when local part is separators only", () => {
    // Local part collapses to "" after stripping separators → raw fallback.
    expect(oauthActor("...-@x.com").name).toBe("...-@x.com");
  });

  it("oauthActor caps the derived name for a pathological local part", () => {
    // A very long local part must not inflate the in-memory name unbounded.
    const longLocal = "a".repeat(5000);
    const a = oauthActor(`${longLocal}@x.com`);
    expect(a.name.length).toBeLessThanOrEqual(64);
    expect(a.email).toBe(`${longLocal}@x.com`); // email preserved verbatim
  });

  it("apiKeyActor builds deterministic synthetic identity", () => {
    const a = apiKeyActor("acme");
    expect(a.email).toBe("service-account@acme.invalid");
    expect(a.name).toBe("acme service-account");
    expect(a.source).toBe("api_key");
  });

  it("anonymousActor builds empty-email actor", () => {
    const a = anonymousActor();
    expect(a.email).toBe("");
    expect(a.name).toBe("anonymous");
    expect(a.source).toBe("anonymous");
  });
});

describe("getTenantContextOrUndefined", () => {
  it("returns undefined outside runWithTenantContext", () => {
    expect(getTenantContextOrUndefined()).toBeUndefined();
  });

  it("returns ctx inside runWithTenantContext", () => {
    runWithTenantContext(ctx("acme"), () => {
      expect(getTenantContextOrUndefined()?.tenantSlug).toBe("acme");
    });
  });
});
