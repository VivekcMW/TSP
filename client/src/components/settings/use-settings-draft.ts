import { useCallback, useEffect, useState } from "react";
import { useSettingsDirty } from "./settings-navigation-guard";

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Refetches hydrate pristine forms only. A save acknowledges its submitted snapshot,
 * not any newer edits the user made while the request was in flight. */
export function useSettingsDraft<T>(source: T) {
  const [state, setState] = useState({ baseline: source, draft: source });
  const serialized = JSON.stringify(source);
  useEffect(() => {
    const next = JSON.parse(serialized) as T;
    setState((current) => equal(current.draft, current.baseline)
      ? { baseline: next, draft: next }
      : current);
  }, [serialized]);
  const setDraft = useCallback((update: T | ((current: T) => T)) => {
    setState((current) => ({ ...current, draft: typeof update === "function" ? (update as (value: T) => T)(current.draft) : update }));
  }, []);
  const acknowledge = useCallback((submitted: T, saved: T = submitted) => {
    setState((current) => ({ baseline: saved, draft: equal(current.draft, submitted) ? saved : current.draft }));
  }, []);
  const reset = useCallback(() => {
    const latest = JSON.parse(serialized) as T;
    setState({ baseline: latest, draft: latest });
  }, [serialized]);
  const dirty = !equal(state.draft, state.baseline);
  useSettingsDirty(dirty);
  return { draft: state.draft, setDraft, acknowledge, reset, dirty };
}