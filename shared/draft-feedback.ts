/** A bounded, content-free edit metric for model-quality evaluation. */
export function draftChangeRatio(before: string, after: string): number {
  if (before === after) return 0;
  const longest = Math.max(before.length, after.length);
  if (longest === 0) return 0;
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  const remainingBefore = before.length - prefix;
  const remainingAfter = after.length - prefix;
  while (suffix < remainingBefore && suffix < remainingAfter
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const unchanged = Math.min(longest, prefix + suffix);
  return Math.round((1 - unchanged / longest) * 10_000) / 10_000;
}
