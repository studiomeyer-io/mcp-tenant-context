import { describe, it, expect } from "vitest";
import {
  getTenantContext,
  NoTenantContextError,
} from "../src/index.js";

describe("NoTenantContextError", () => {
  it("throws NoTenantContextError when getTenantContext is called outside run", () => {
    expect(() => getTenantContext()).toThrow(NoTenantContextError);
  });

  it("is catchable as the specific subclass", () => {
    let caught: unknown;
    try {
      getTenantContext();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(NoTenantContextError);
    expect(caught).toBeInstanceOf(Error);
  });

  it("has the canonical error name + descriptive message", () => {
    try {
      getTenantContext();
    } catch (e) {
      const err = e as NoTenantContextError;
      expect(err.name).toBe("NoTenantContextError");
      expect(err.message).toMatch(/TENANT_CONTEXT_MISSING/);
      expect(err.message).toMatch(/runWithTenantContext/);
    }
  });

  it("accepts a custom message", () => {
    const err = new NoTenantContextError("custom reason");
    expect(err.message).toBe("custom reason");
    expect(err).toBeInstanceOf(NoTenantContextError);
  });
});
