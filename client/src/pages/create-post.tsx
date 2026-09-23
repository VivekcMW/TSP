import { useCreatePost } from "@/components/dashboard/create-post-provider";
import { InstantReviewPanel } from "@/components/dashboard/instant-review-panel";

/** Dedicated dashboard surface for creation; the provider keeps its session alive across navigation. */
export default function CreatePostPage() {
  const { composer, closeCreate } = useCreatePost();
  return <InstantReviewPanel isOpen onClose={closeCreate} composer={composer} />;
}