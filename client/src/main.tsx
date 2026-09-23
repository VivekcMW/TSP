import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initSentry, Sentry } from "./lib/sentry";

initSentry();

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
    <App />
  </Sentry.ErrorBoundary>,
);

function ErrorFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-center">
      <div>
        <p className="text-lg font-semibold">Something went wrong.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The error has been reported. Try reloading the page.
        </p>
      </div>
    </div>
  );
}
