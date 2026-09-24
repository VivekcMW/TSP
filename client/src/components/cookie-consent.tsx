import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { COOKIE_SETTINGS_EVENT, readAnalyticsConsent, saveAnalyticsConsent, type AnalyticsConsent } from "@/lib/analytics-consent";

/** Asks once for analytics consent; "Cookie settings" in the footers reopens it. */
export function CookieConsent() {
  const [open, setOpen] = useState(() => readAnalyticsConsent() === null);

  useEffect(() => {
    const reopen = () => setOpen(true);
    window.addEventListener(COOKIE_SETTINGS_EVENT, reopen);
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, reopen);
  }, []);

  if (!open) return null;
  const choose = (value: AnalyticsConsent) => { saveAnalyticsConsent(value); setOpen(false); };
  return (
    <section
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[60] border-t bg-card px-4 pt-4 shadow-lg sm:px-6"
      style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-foreground">
          We'd like to use analytics cookies to understand how TheSocialPundit is used and improve it.
          Essential cookies that keep you signed in are always on.{" "}
          <a href="/cookies" className="font-medium underline underline-offset-2">Cookie Policy</a>
        </p>
        <div className="flex shrink-0 gap-2 [&_button]:min-h-11">
          <Button type="button" onClick={() => choose("denied")}>Reject</Button>
          <Button type="button" onClick={() => choose("granted")}>Accept analytics</Button>
        </div>
      </div>
    </section>
  );
}
