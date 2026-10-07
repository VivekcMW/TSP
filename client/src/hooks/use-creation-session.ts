import { useEffect, useRef, useState } from "react";
import { creationSessionResponseSchema, creationSessionSchema, type CreationSession } from "@shared/creation-session";
import { accountCache, apiRequest } from "@/lib/queryClient";

const serializedState = (value: unknown) => JSON.stringify(value, (_key, next) =>
  next && typeof next === "object" && !Array.isArray(next)
    ? Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b))) : next);

export function useCreationSession(enabled: boolean, scope: string, read: () => CreationSession, restore: (state: CreationSession) => void) {
  const callbacks = useRef({ read, restore });
  callbacks.current = { read, restore };
  const session = useRef({ revision: 0, loaded: false, saving: false, confirmed: "", desired: "", error: false });
  const lifetime = useRef(new AbortController());
  const loading = useRef<AbortController>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [status, setStatus] = useState<"loading" | "saved" | "unsaved" | "saving" | "error">("loading");
  const [error, setError] = useState("");

  async function load() {
    loading.current?.abort();
    loading.current = new AbortController();
    const signal = AbortSignal.any([lifetime.current.signal, loading.current.signal, accountCache.getSignal()]);
    setStatus("loading"); setError("");
    try {
      const response = await apiRequest("GET", "/api/creation-session", undefined, { signal, cache: "no-store" });
      const data = creationSessionResponseSchema.parse(await response.json());
      if (signal.aborted) return;
      if (data.state) callbacks.current.restore(data.state);
      session.current = { revision: data.revision, loaded: true, saving: false,
        confirmed: data.state ? serializedState(data.state) : "", desired: "", error: false };
      setStatus("saved");
    } catch (cause) {
      if (signal.aborted) return;
      session.current.error = true;
      setError(cause instanceof Error ? cause.message : "Could not load the saved creation.");
      setStatus("error");
    }
  }

  async function save() {
    const current = session.current;
    if (!current.loaded || current.saving || lifetime.current.signal.aborted) return;
    clearTimeout(timer.current);
    current.saving = true; current.error = false; setError(""); setStatus("saving");
    const signal = AbortSignal.any([lifetime.current.signal, accountCache.getSignal()]);
    try {
      const state = creationSessionSchema.parse(callbacks.current.read());
      const serialized = serializedState(state);
      if (serialized !== current.confirmed) {
        const response = await apiRequest("PUT", "/api/creation-session", { revision: current.revision, state },
          { signal });
        const data = creationSessionResponseSchema.parse(await response.json());
        if (signal.aborted || session.current !== current) return;
        if (serializedState(data.state) !== serialized) throw new Error("The saved creation did not match your changes. Keep this tab open and retry.");
        current.revision = data.revision; current.confirmed = serialized;
      }
      setStatus(serializedState(callbacks.current.read()) === current.confirmed ? "saved" : "unsaved");
    } catch (cause) {
      if (signal.aborted || session.current !== current) return;
      current.error = true;
      setError(cause instanceof Error ? cause.message : "Could not save your creation. Keep this tab open.");
      setStatus("error");
    } finally {
      current.saving = false;
      if (!signal.aborted && !current.error && serializedState(callbacks.current.read()) !== current.confirmed) schedule();
    }
  }
  function schedule() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 800);
  }
  useEffect(() => {
    lifetime.current = new AbortController();
    session.current = { revision: 0, loaded: false, saving: false, confirmed: "", desired: "", error: false };
    if (enabled) void load();
    return () => { lifetime.current.abort(); clearTimeout(timer.current); };
  }, [enabled, scope]);
  useEffect(() => {
    const current = session.current;
    if (!enabled || !current.loaded) return;
    const next = serializedState(callbacks.current.read());
    if (next === current.desired) return;
    current.desired = next;
    if (next === current.confirmed || current.error) return;
    if (!current.saving) { setStatus("unsaved"); schedule(); }
  });
  return { status, error, ready: session.current.loaded, save,
    reload: () => {
      if (session.current.saving) return;
      if (session.current.loaded && serializedState(callbacks.current.read()) !== session.current.confirmed &&
        !window.confirm("Reload the saved creation and discard your unsaved local changes?")) return;
      clearTimeout(timer.current); session.current.loaded = false; void load();
    },
    unsaved: session.current.loaded && status !== "saved",
  };
}
