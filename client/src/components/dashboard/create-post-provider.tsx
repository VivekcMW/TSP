import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import type { InboxItem } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useCreatePostComposer, type CreatePostComposer } from "./use-create-post-composer";
import { STORY_LINK_KEY, storyLinkFromSearch, storyLinkFromState, withoutArticleParam, withoutStoryLink } from "@/lib/create-story-link";

export interface CreatePostContextValue {
  openCreate: (item?: InboxItem) => void;
  hasCreation: boolean;
  startNewCreate: () => void;
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
  const onCreateRoute = location === "/dashboard/create";
  const composer = useCreatePostComposer(isOpen, onCreateRoute);
  const pendingEntry = useRef<{ item: InboxItem } | { startNew: true }>();
  useEffect(() => { if (onCreateRoute) setOpen(true); }, [onCreateRoute]);
  // Onboarding's "Write a post" (navigation state) and reminder emails (?article=) arrive with a story link;
  // use it once, then drop it from history.
  useEffect(() => {
    if (!onCreateRoute || !composer.persistence.ready) return;
    const { pathname, search } = window.location;
    const link = storyLinkFromState(window.history.state) ?? storyLinkFromSearch(search);
    const hasStoryState = window.history.state && typeof window.history.state === "object" &&
      Object.hasOwn(window.history.state, STORY_LINK_KEY);
    if (!hasStoryState && !new URLSearchParams(search).has("article")) return;
    window.history.replaceState(withoutStoryLink(window.history.state), "", withoutArticleParam(pathname, search));
    if (!link) return;
    composer.prefillUrl(link);
    // Runs only on arrival at Create; the composer's later state must not re-apply the link.
  }, [onCreateRoute, composer.persistence.ready]);
  useEffect(() => {
    if (!onCreateRoute || !composer.persistence.ready || !pendingEntry.current) return;
    const entry = pendingEntry.current;
    pendingEntry.current = undefined;
    if ("item" in entry) composer.prefill(entry.item);
    else composer.startNewCreate();
  }, [onCreateRoute, composer.persistence.ready]);
  useEffect(() => { if (composer.generation.reattached) setOpen(true); }, [composer.generation.reattached]);
  const openCreate = (item?: InboxItem) => {
    if (!composer.persistence.ready) {
      if (item) pendingEntry.current = { item };
    } else if (!composer.prefill(item)) return;
    setOpen(true);
    if (!onCreateRoute) navigate("/dashboard/create");
  };
  const startNewCreate = () => {
    if (!composer.persistence.ready) pendingEntry.current = { startNew: true };
    else if (!composer.startNewCreate()) return;
    setOpen(true);
    if (!onCreateRoute) navigate("/dashboard/create");
  };
  const close = () => {
    if ((composer.dirty || composer.busy || composer.generation.recoverable) && !window.confirm(
      "Leave Create while changes or generation are pending? Wait for All changes saved before reloading or signing out. Saved progress will be available when you return. Choose Cancel to keep editing.",
    )) return false;
    setOpen(false);
    if (onCreateRoute) navigate("/dashboard");
    return true;
  };
  const contextValue = useMemo(() => ({ openCreate, isOpen }), [openCreate, isOpen]);
  const providerValue = useMemo(() => ({ ...contextValue, composer, hasCreation: composer.hasCreation, startNewCreate, closeCreate: close }), [contextValue, composer, startNewCreate, close]);
  return <CreatePostContext.Provider value={providerValue}>
    {children}
  </CreatePostContext.Provider>;
}

/** Safe on public/isolated surfaces: reports missing wiring instead of crashing. */
export function useCreatePost(): CreatePostContextValue {
  const context = useContext(CreatePostContext);
  const { toast } = useToast();
  const unavailable = () => { toast({ title: "Create is unavailable here", description: "Open your workspace to create a draft.", variant: "destructive" }); };
  return context ?? { isOpen: false, hasCreation: false, openCreate: unavailable, startNewCreate: unavailable, composer: undefined as never, closeCreate: () => false };
}