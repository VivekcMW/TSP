import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "../../client/src/App";
import { queryClient, accountCache } from "../../client/src/lib/queryClient";
import { signOut } from "../../client/src/lib/auth";
import { setSession, setLogoutResult } from "./auth-fixture";

let resolveOld: ((value: string) => void) | undefined;
Object.assign(window, { security: {
  setSession, setLogoutResult,
  snapshot: () => accountCache.getSnapshot(),
  cache: () => queryClient.getQueryCache().getAll().map(query => ({ key: query.queryKey, data: query.state.data })),
  refetch: (key: string) => queryClient.refetchQueries({ queryKey: [key] }),
  seed: () => queryClient.setQueryData(["private-marker"], "private-a"),
  startOld: () => { void queryClient.fetchQuery({ queryKey: ["late-result"], queryFn: () => new Promise<string>(resolve => { resolveOld = resolve; }) }).catch(() => {}); },
  finishOld: () => resolveOld?.("private-a"),
  signOut: () => signOut("#signedout").catch(error => error.message),
} });
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);