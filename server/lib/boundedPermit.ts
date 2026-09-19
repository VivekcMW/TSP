/** Process-local, synchronous admission. No queue, timers, or automatic expiry. */
export function createBoundedPermitPool(maxActive: number, maxBytes: number) {
  if (![maxActive, maxBytes].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("Invalid permit bounds");
  }
  let active = 0;
  let reservedBytes = 0;
  return {
    snapshot: () => ({ active, reservedBytes }),
    tryAcquire(bytes: number): (() => void) | undefined {
      if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error("Invalid permit reservation");
      if (active >= maxActive || bytes > maxBytes - reservedBytes) return undefined;
      active++;
      reservedBytes += bytes;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active--;
        reservedBytes -= bytes;
      };
    },
  };
}