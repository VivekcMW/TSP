/**
 * Concurrency guard shared by every free public AI tool. Per instance, so anonymous traffic can
 * never hold every shared AI slot paying users rely on.
 */
const MAX_CONCURRENT = Math.max(1, Number(process.env.PUBLIC_POST_TOOL_MAX_CONCURRENT) || 2);
let active = 0;

export class PublicToolBusyError extends Error {
  constructor() {
    super("The free tool is busy right now. Please try again in a few seconds.");
    this.name = "PublicToolBusyError";
  }
}

export async function withPublicToolSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) throw new PublicToolBusyError();
  active++;
  try {
    return await work();
  } finally {
    active--;
  }
}
