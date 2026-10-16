import { describe, expect, it } from "vitest";
import { createBoundedPermitPool } from "./boundedPermit";

describe("bounded process-local permits", () => {
  it("admits synchronously, rejects a burst without waiters, and releases once", () => {
    const pool = createBoundedPermitPool(2, 100);
    const first = pool.tryAcquire(50)!;
    const second = pool.tryAcquire(50)!;
    for (let i = 0; i < 1000; i++) expect(pool.tryAcquire(1)).toBeUndefined();
    expect(pool.snapshot()).toEqual({ active: 2, reservedBytes: 100 });
    first(); first();
    expect(pool.snapshot()).toEqual({ active: 1, reservedBytes: 50 });
    const third = pool.tryAcquire(50)!;
    second(); second(); third(); third();
    expect(pool.snapshot()).toEqual({ active: 0, reservedBytes: 0 });
  });
  it("enforces the byte cap independently of request count", () => {
    const pool = createBoundedPermitPool(8, 75);
    expect(pool.tryAcquire(76)).toBeUndefined();
    const release = pool.tryAcquire(50)!;
    expect(pool.tryAcquire(50)).toBeUndefined();
    release();
    expect(pool.tryAcquire(75)).toBeTypeOf("function");
  });
  it("enforces count independently of bytes", () => {
    const pool = createBoundedPermitPool(1, 1000);
    pool.tryAcquire(1);
    expect(pool.tryAcquire(1)).toBeUndefined();
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid bound/reservation %s", value => {
    expect(() => createBoundedPermitPool(value, 100)).toThrow();
    expect(() => createBoundedPermitPool(2, value)).toThrow();
    expect(() => createBoundedPermitPool(2, 100).tryAcquire(value)).toThrow();
  });
});