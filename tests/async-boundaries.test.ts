/**
 * Async-context-correctness suite.
 *
 * The entire value proposition of this library is that the tenant context
 * survives every async boundary a Node handler realistically crosses — and is
 * *correctly absent* across the one boundary AsyncLocalStorage cannot follow
 * (a listener registered in a different async context).
 *
 * Each test below pins one boundary so a future Node / AsyncLocalStorage
 * regression, or a refactor of `runWithTenantContext`, would fail loudly.
 */

import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import {
  runWithTenantContext,
  getTenantContext,
  getTenantContextOrUndefined,
  bindTenantContext,
  oauthActor,
  NoTenantContextError,
  type TenantContext,
} from "../src/index.js";

function ctx(tenantSlug: string): TenantContext {
  return { tenantSlug, actor: oauthActor("ada@acme.example") };
}

const slug = () => getTenantContext().tenantSlug;

describe("context survives async boundaries", () => {
  it("await chain (multiple sequential awaits)", async () => {
    const got = await runWithTenantContext(ctx("acme"), async () => {
      await delay(1);
      await delay(1);
      await Promise.resolve();
      return slug();
    });
    expect(got).toBe("acme");
  });

  it("queueMicrotask callback", async () => {
    const got = await runWithTenantContext(ctx("acme"), () => {
      return new Promise<string>((resolve) => {
        queueMicrotask(() => resolve(slug()));
      });
    });
    expect(got).toBe("acme");
  });

  it("process.nextTick callback", async () => {
    const got = await runWithTenantContext(ctx("acme"), () => {
      return new Promise<string>((resolve) => {
        process.nextTick(() => resolve(slug()));
      });
    });
    expect(got).toBe("acme");
  });

  it("setImmediate callback", async () => {
    const got = await runWithTenantContext(ctx("acme"), () => {
      return new Promise<string>((resolve) => {
        setImmediate(() => resolve(slug()));
      });
    });
    expect(got).toBe("acme");
  });

  it("setTimeout callback on the rejection path", async () => {
    // The happy resolve path is covered in tenant-context.test.ts; here we make
    // sure the context is intact when the timer rejects, so error handlers can
    // still attribute the failure to a tenant.
    await expect(
      runWithTenantContext(ctx("acme"), () => {
        return new Promise<never>((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error(`failed for ${slug()}`));
          }, 1);
        });
      }),
    ).rejects.toThrow("failed for acme");
  });

  it("setInterval callback (cleared after first tick)", async () => {
    const got = await runWithTenantContext(ctx("acme"), () => {
      return new Promise<string>((resolve) => {
        const handle = setInterval(() => {
          clearInterval(handle);
          resolve(slug());
        }, 1);
      });
    });
    expect(got).toBe("acme");
  });

  it("Promise.all preserves context in every branch and across the join", async () => {
    const got = await runWithTenantContext(ctx("acme"), async () => {
      const [a, b, c] = await Promise.all([
        (async () => {
          await delay(2);
          return slug();
        })(),
        (async () => {
          await delay(1);
          return slug();
        })(),
        Promise.resolve(slug()),
      ]);
      // ...and after the join itself.
      return [a, b, c, slug()];
    });
    expect(got).toEqual(["acme", "acme", "acme", "acme"]);
  });

  it("Promise.race preserves context in the winning branch and after", async () => {
    const got = await runWithTenantContext(ctx("acme"), async () => {
      const winner = await Promise.race([
        (async () => {
          await delay(1);
          return `fast:${slug()}`;
        })(),
        (async () => {
          await delay(50);
          return `slow:${slug()}`;
        })(),
      ]);
      return `${winner}|after:${slug()}`;
    });
    expect(got).toBe("fast:acme|after:acme");
  });

  it("Promise.allSettled preserves context across mixed fulfil/reject", async () => {
    const got = await runWithTenantContext(ctx("acme"), async () => {
      const results = await Promise.allSettled([
        Promise.resolve(slug()),
        Promise.reject(new Error("nope")),
      ]);
      const fulfilled = results[0];
      // Context must still be readable after the settle.
      return fulfilled.status === "fulfilled"
        ? `${fulfilled.value}|${slug()}`
        : `unexpected|${slug()}`;
    });
    expect(got).toBe("acme|acme");
  });
});

describe("nested run() interactions across async boundaries", () => {
  it("inner ctx wins inside its scope, outer is restored after an await", async () => {
    const trace: string[] = [];
    await runWithTenantContext(ctx("outer"), async () => {
      trace.push(slug());
      await runWithTenantContext(ctx("inner"), async () => {
        await delay(1);
        trace.push(slug());
      });
      await delay(1);
      trace.push(slug());
    });
    expect(trace).toEqual(["outer", "inner", "outer"]);
  });

  it("concurrent nested runs inside one outer scope do not bleed", async () => {
    const seen: string[] = [];
    await runWithTenantContext(ctx("outer"), async () => {
      await Promise.all([
        runWithTenantContext(ctx("child-a"), async () => {
          await delay(3);
          seen.push(slug());
        }),
        runWithTenantContext(ctx("child-b"), async () => {
          await delay(1);
          seen.push(slug());
        }),
      ]);
      // Outer restored once both children resolve.
      seen.push(slug());
    });
    expect(seen.sort()).toEqual(["child-a", "child-b", "outer"]);
  });
});

describe("context is correctly ABSENT across detached listeners", () => {
  it("an EventEmitter listener registered inside run() loses the context", async () => {
    const ee = new EventEmitter();
    let insideRun: TenantContext | undefined;
    let insideListener: TenantContext | undefined;

    await runWithTenantContext(ctx("acme"), async () => {
      insideRun = getTenantContextOrUndefined();
      ee.on("ping", () => {
        // Different async context — store is not visible here.
        insideListener = getTenantContextOrUndefined();
      });
      // Let the scope fully settle before emitting from outside it.
      await delay(1);
    });

    ee.emit("ping");
    expect(insideRun?.tenantSlug).toBe("acme");
    expect(insideListener).toBeUndefined();
  });

  it("getTenantContext() throws inside a plain detached listener", () => {
    const ee = new EventEmitter();
    let thrown: unknown;
    runWithTenantContext(ctx("acme"), () => {
      ee.on("ping", () => {
        try {
          getTenantContext();
        } catch (e) {
          thrown = e;
        }
      });
    });
    ee.emit("ping");
    expect(thrown).toBeInstanceOf(NoTenantContextError);
  });

  it("a stream 'data' listener registered outside the scope loses the context", async () => {
    const stream = Readable.from(["chunk"]);
    let inListener: TenantContext | undefined;
    const done = new Promise<void>((resolve) => {
      stream.on("data", () => {
        inListener = getTenantContextOrUndefined();
      });
      stream.on("end", () => resolve());
    });
    await done;
    expect(inListener).toBeUndefined();
  });
});

describe("bindTenantContext recovers the context in detached callbacks", () => {
  it("binds the context for an EventEmitter listener", () => {
    const ee = new EventEmitter();
    let seen: string | undefined;
    runWithTenantContext(ctx("acme"), () => {
      ee.on(
        "ping",
        bindTenantContext(() => {
          seen = slug();
        }),
      );
    });
    ee.emit("ping");
    expect(seen).toBe("acme");
  });

  it("binds the context for a stream 'data' listener and forwards the chunk", async () => {
    const stream = Readable.from(["alpha", "beta"]);
    const seen: Array<{ slug: string; chunk: string }> = [];

    await runWithTenantContext(ctx("acme"), async () => {
      const onData = bindTenantContext((chunk: Buffer | string) => {
        seen.push({ slug: slug(), chunk: chunk.toString() });
      });
      stream.on("data", onData);
      await new Promise<void>((resolve) => stream.on("end", () => resolve()));
    });

    expect(seen).toEqual([
      { slug: "acme", chunk: "alpha" },
      { slug: "acme", chunk: "beta" },
    ]);
  });

  it("the bound callback observes the context even after run() has fully exited", async () => {
    const ee = new EventEmitter();
    let bound: (() => string) | undefined;

    await runWithTenantContext(ctx("acme"), async () => {
      bound = bindTenantContext(() => slug());
      await delay(1);
    });

    // run() is over; the live store is empty...
    expect(getTenantContextOrUndefined()).toBeUndefined();
    // ...but the snapshot the listener captured is still intact.
    ee.on("go", () => {
      /* registration site, deliberately empty */
    });
    expect(bound?.()).toBe("acme");
  });

  it("preserves the function's argument and return types", () => {
    // Type-level assertion: bindTenantContext must not widen the signature.
    const add = (a: number, b: number): number => a + b;
    const bound = bindTenantContext(add);
    const result: number = bound(2, 3);
    expect(result).toBe(5);
  });

  it("binds the empty context when called with no active tenant (no crash)", () => {
    // Binding outside a run() is harmless: the snapshot is empty, so the bound
    // fn behaves exactly as an unbound one would.
    const bound = bindTenantContext(() => getTenantContextOrUndefined());
    expect(bound()).toBeUndefined();
  });

  it("the bound fn restores its OWN snapshot, not the caller's live context", () => {
    const ee = new EventEmitter();
    let seen: string | undefined;

    // Capture "acme" at registration time.
    runWithTenantContext(ctx("acme"), () => {
      ee.on(
        "ping",
        bindTenantContext(() => {
          seen = slug();
        }),
      );
    });

    // Emit from inside a *different* live context ("other"). The bound listener
    // must still see "acme" — the snapshot wins over the ambient store.
    runWithTenantContext(ctx("other"), () => {
      ee.emit("ping");
    });
    expect(seen).toBe("acme");
  });
});
