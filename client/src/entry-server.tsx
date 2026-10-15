import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { Router } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PublicRoutes } from "@/components/public-routes";
import { RouteTransition } from "@/components/route-transition";

/**
 * Build-time prerendering of the public marketing pages (see script/prerender.ts).
 * Renders the same route tree the browser renders for a signed-out visitor, so crawlers and
 * visitors receive the real headings, copy and links before any JavaScript runs. Entrance
 * animations are skipped, so nothing is left at its invisible starting frame.
 */
export function render(pathname: string): Promise<string> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  return new Promise((resolve, reject) => {
    let failed: unknown;
    const { pipe } = renderToPipeableStream(
      <Router ssrPath={pathname}>
        <QueryClientProvider client={queryClient}>
          <HelmetProvider context={{}}>
            <TooltipProvider>
              <RouteTransition transitionKey={path => path} skipInitialAnimation>
                {location => <PublicRoutes location={location} />}
              </RouteTransition>
            </TooltipProvider>
          </HelmetProvider>
        </QueryClientProvider>
      </Router>,
      {
        // Wait for lazy route chunks so the page itself is rendered, not the Suspense fallback.
        onAllReady() {
          if (failed) return reject(failed);
          const chunks: Buffer[] = [];
          const sink = new PassThrough();
          sink.on("data", chunk => chunks.push(Buffer.from(chunk)));
          sink.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          sink.on("error", reject);
          pipe(sink);
        },
        onShellError: reject,
        onError(error) { failed = error; },
      },
    );
  });
}
