import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import type { InboxItem } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useCreatePostComposer, type CreatePostComposer } from "./use-create-post-composer";
import { storyLinkFromSearch, storyLinkFromState, withoutArticleParam, withoutStoryLink } from "@/lib/create-story-link";

export interface CreatePostContextValue {
  openCreate: (item?: InboxItem) => void;
  isOpen: boolean;
  composer: CreatePostComposer;
  closeCreate: () => boolean;
}
const CreatePostContext = createContext<CreatePostContextValue | null>(null);

/** Mount once above route transitions, inside the authenticated query provider.
 * Key/remount by account + tenant when either changes; no drafts go to web storage.
 */
export function CreatePostProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [location, navigate] = useLocation();
  const [isOpen, setOpen] = useState(false);
  const composer = useCreatePostComposer(isOpen);
  const onCreateRoute = location === "/dashboard/create";
  useEffect(() => { if (onCreateRoute) setOpen(true); }, [onCreateRoute]);
  // Onboarding's "Write a post" (navigation state) and reminder emails (?article=) arrive with a story link;
  // use it once, then drop it from history.
  useEffect(() => {
    if (!onCreateRoute) return;
    const { pathname, search } = window.location;
    const link = storyLinkFromState(window.history.state) ?? storyLinkFromSearch(search);
    if (!link && !new URLSearchParams(search).has("article")) return;
    window.history.replaceState(withoutStoryLink(window.history.state), "", withoutArticleParam(pathname, search));
    if (!link) return;
    if (composer.busy || composer.dirty) return;
    composer.setMode("article");
    composer.setUrl(link);
    // Runs only on arrival at Create; the composer's later state must not re-apply the link.
  }, [onCreateRoute]);
  useEffect(() => { if (composer.generation.reattached) setOpen(true); }, [composer.generation.reattached]);
  const openCreate = (item?: InboxItem) => {
    composer.prefill(item);
    setOpen(true);
    if (!onCreateRoute) navigate("/dashboard/create");
  };
  const close = () => {
    if ((composer.dirty || composer.busy || composer.generation.recoverable) && !window.confirm(
      "Close Create? Unsaved text is lost on reload or sign-out. An admitted generation can reconnect in this tab while its server result is retained. Generation continues; unfinished uploads are cancelled. Choose Cancel to keep editing.",
    )) return false;
    setOpen(false);
    if (onCreateRoute) navigate("/dashboard");
    return true;
  };
  const contextValue = useMemo(() => ({ openCreate, isOpen }), [openCreate, isOpen]);
  const providerValue = useMemo(() => ({ ...contextValue, composer, closeCreate: close }), [contextValue, composer, close]);
  return <CreatePostContext.Provider value={providerValue}>
    {children}
  </CreatePostContext.Provider>;
}

/** Safe on public/isolated surfaces: reports missing wiring instead of crashing. */
export function useCreatePost(): CreatePostContextValue {
  const context = useContext(CreatePostContext);
  const { toast } = useToast();
  return context ?? { isOpen: false, openCreate: () => toast({ title: "Create is unavailable here", description: "Open your workspace to create a draft.", variant: "destructive" }), composer: undefined as never, closeCreate: () => false };
}