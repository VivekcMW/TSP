import { createContext, useContext, useState, type ReactNode } from "react";
import type { InboxItem } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { InstantReviewPanel } from "./instant-review-panel";
import { useCreatePostComposer } from "./use-create-post-composer";

export interface CreatePostContextValue {
  openCreate: (item?: InboxItem) => void;
  isOpen: boolean;
}
const CreatePostContext = createContext<CreatePostContextValue | null>(null);

/** Mount once above route transitions, inside the authenticated query provider.
 * Key/remount by account + tenant when either changes; no drafts go to web storage.
 */
export function CreatePostProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [isOpen, setOpen] = useState(false);
  const composer = useCreatePostComposer(isOpen);
  const openCreate = (item?: InboxItem) => {
    composer.prefill(item);
    setOpen(true);
  };
  const close = () => {
    if ((composer.dirty || composer.busy || composer.generation.recoverable) && !window.confirm(
      "Close Create? Unsaved work stays in this session across pages, but is lost on reload or sign-out. Generation continues; unfinished uploads are cancelled. Choose Cancel to keep editing.",
    )) return false;
    setOpen(false);
    return true;
  };
  return <CreatePostContext.Provider value={{ openCreate, isOpen }}>
    {children}
    <InstantReviewPanel isOpen={isOpen} onClose={close} composer={composer} />
  </CreatePostContext.Provider>;
}

/** Safe on public/isolated surfaces: reports missing wiring instead of crashing. */
export function useCreatePost(): CreatePostContextValue {
  const context = useContext(CreatePostContext);
  const { toast } = useToast();
  return context ?? { isOpen: false, openCreate: () => toast({ title: "Create is unavailable here", description: "Open your workspace to create a draft.", variant: "destructive" }) };
}