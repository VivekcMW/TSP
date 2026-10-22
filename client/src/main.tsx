import { createRoot } from "react-dom/client";
import App from "./App";
import "./fonts";
import "./index.css";
import { initSentry, Sentry } from "./lib/sentry";
import { startAnalyticsIfConsented } from "./lib/analytics-consent";
import { PrerenderHandoff } from "./lib/prerender";
import { queryClient } from "./lib/queryClient";
import { PRICING_DATA_ID, publicBillingCatalogueSchema } from "@shared/public-billing";

initSentry();
const pricingData = document.getElementById(PRICING_DATA_ID);
if (pricingData) {
  try {
    queryClient.setQueryData(["/api/public/billing/plans"], publicBillingCatalogueSchema.parse(JSON.parse(pricingData.textContent ?? "")));
  } catch {
    console.error("Initial pricing data is invalid; reloading the public catalogue");
  }
  pricingData.remove();
}
startAnalyticsIfConsented();

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
    <App />
  </Sentry.ErrorBoundary>,
);

function ErrorFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-center">
      {/* Otherwise the prerendered page would stay on screen with nothing behind it working. */}
      <PrerenderHandoff />
      <div>
        <p className="text-lg font-semibold">Something went wrong.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The error has been reported. Try reloading the page.
        </p>
      </div>
    </div>
  );
}
