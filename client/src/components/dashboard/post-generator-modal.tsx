import { useEffect, useRef } from "react";
import type { InboxItem } from "@shared/schema";
import { useCreatePost } from "./create-post-provider";

interface PostGeneratorModalProps {
  item: InboxItem | null;
  isOpen: boolean;
  onClose: () => void;
  /** Deprecated: the shared composer is the sole save/copy/open owner. */
  onSaveDraft?: (platform: string, tone: string, content: string) => void;
  onPost?: (platform: string, tone: string, content: string) => void;
}

/** Compatibility launcher, not a second dialog or generation surface. */
export function PostGeneratorModal({ item, isOpen, onClose }: PostGeneratorModalProps) {
  const { openCreate } = useCreatePost();
  const launched = useRef(false);
  useEffect(() => {
    if (!isOpen) { launched.current = false; return; }
    if (launched.current) return;
    launched.current = true;
    openCreate(item ?? undefined);
    onClose();
  }, [isOpen, item, openCreate, onClose]);
  return null;
}
