export const MiB = 1024 * 1024;
export function memoryProbe() {
  const baseline = process.memoryUsage();
  const peak = { ...baseline };
  const sample = () => {
    const current = process.memoryUsage();
    for (const key of Object.keys(peak) as (keyof typeof peak)[]) peak[key] = Math.max(peak[key], current[key]);
  };
  return { sample, result() {
    sample();
    return { baseline, sampledPeak: peak, deltaMiB: Object.fromEntries(
      (Object.keys(peak) as (keyof typeof peak)[]).map(key => [key, +(Math.max(0, peak[key] - baseline[key]) / MiB).toFixed(2)]),
    ) as Record<keyof typeof peak, number> };
  } };
}
export function metric(scenario: string, values: Record<string, unknown>) {
  console.log(`WORKFLOW_BUDGET ${JSON.stringify({ scenario, ...values, productionCertification: false })}`);
}