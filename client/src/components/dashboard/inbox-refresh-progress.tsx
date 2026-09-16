import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { Progress } from "../ui/progress";
import type { InboxRefreshProgress } from "../../hooks/use-inbox-refresh";

interface InboxRefreshProgressProps {
  isVisible: boolean;
  isLoading: boolean;
  progress: InboxRefreshProgress;
  error: string | null;
  jobStatus: "queued" | "active" | "completed" | "failed" | null;
  onDismiss?: () => void;
}

/**
 * Progress indicator for inbox refresh jobs.
 * Shows processing status, article counts, and any errors.
 * Non-blocking component that stays visible during refresh.
 */
export function InboxRefreshProgress({
  isVisible,
  isLoading,
  progress,
  error,
  jobStatus,
  onDismiss,
}: InboxRefreshProgressProps) {
  if (!isVisible || !jobStatus) return null;

  const isCompleted = jobStatus === "completed";
  const isFailed = jobStatus === "failed";

  // Estimate progress percentage based on articles processed
  // This is a rough estimate since we don't know total articles in feed
  const estimatedProgress = Math.min(
    Math.max(progress.articlesProcessed * 2, progress.articlesMatched * 5, 20),
    100
  );

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-6 right-6 w-80 z-50"
        >
          <div
            className={`rounded-lg border-2 p-4 shadow-lg ${
              isFailed
                ? "border-destructive bg-destructive/10"
                : isCompleted
                  ? "border-success bg-success/10"
                  : "border-primary bg-primary/5"
            }`}
          >
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              {isFailed ? (
                <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0" />
              ) : isCompleted ? (
                <CheckCircle className="h-5 w-5 text-success flex-shrink-0" />
              ) : (
                <Loader2 className="h-5 w-5 text-primary animate-spin flex-shrink-0" />
              )}

              <div className="flex-1">
                <h3 className="font-semibold text-sm">
                  {isFailed ? "Refresh Failed" : isCompleted ? "Refresh Complete" : "Refreshing Articles"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {isCompleted
                    ? "Your inbox has been updated"
                    : isFailed
                      ? error || "An error occurred"
                      : `${jobStatus === "queued" ? "Queued" : "Processing"}...`}
                </p>
              </div>

              {(isCompleted || isFailed) && onDismiss && (
                <button
                  onClick={onDismiss}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Progress Bar */}
            {!isCompleted && !isFailed && (
              <>
                <Progress value={estimatedProgress} className="mb-3 h-2" />
              </>
            )}

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div>
                <div className="font-semibold text-base">{progress.articlesProcessed}</div>
                <div className="text-xs text-muted-foreground">Processed</div>
              </div>
              <div>
                <div className="font-semibold text-base">{progress.articlesMatched}</div>
                <div className="text-xs text-muted-foreground">Matched</div>
              </div>
              <div>
                <div className={`font-semibold text-base ${isCompleted ? "text-success" : ""}`}>
                  {progress.articlesCreated}
                </div>
                <div className="text-xs text-muted-foreground">Created</div>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mt-3 p-2 bg-destructive/20 rounded text-xs text-destructive">{error}</div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
