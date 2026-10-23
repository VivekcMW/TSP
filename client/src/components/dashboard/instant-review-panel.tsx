import type { CreatePostComposer } from "./use-create-post-composer";
import { ArticleBentoBoard } from "./article-bento-board";

interface InstantReviewPanelProps {
  isOpen: boolean;
  onClose: () => boolean;
  composer: CreatePostComposer;
}

export function InstantReviewPanel({ composer }: Readonly<InstantReviewPanelProps>) {
  return <main className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
    <ArticleBentoBoard composer={composer} />
  </main>;
}
