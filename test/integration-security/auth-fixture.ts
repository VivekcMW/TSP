import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const makeUser = (id: string) => ({ id, name: `Person ${id}`, email: `${id}@example.invalid`, emailVerified: true, image: null });
let state = { data: { user: makeUser("a"), session: { id: "session-a" } } as { user: ReturnType<typeof makeUser>; session: { id: string } } | null, isPending: false };
export function setSession(id: string | null, pending = false) {
  state = { data: id ? { user: makeUser(id), session: { id: `session-${id}` } } : null, isPending: pending };
  listeners.forEach(listener => listener());
}
let logoutResult: "success" | "error" | "throw" = "success";
export function setLogoutResult(result: typeof logoutResult) { logoutResult = result; }
export const authClient = {
  useSession: () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => state),
  async signOut() {
    if (logoutResult === "throw") throw new Error("Offline");
    if (logoutResult === "error") return { error: { message: "Rejected" } };
    setSession(null);
    return { error: null };
  },
  async updateUser() { return { error: null }; },
};