import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProfileSettingsPage from "@/pages/profile-settings";
import PluginsPage from "@/pages/plugins";
import ConnectionsPage from "@/pages/analytics";
import BillingPage from "@/pages/billing";
import { AccountSettings } from "./account-settings";
import { NotificationSettings } from "./notification-settings";
import { SettingsNavigationGuard } from "./settings-navigation-guard";
import { EditorialVoiceSettings } from "./editorial-voice-settings";

export const SETTINGS_SECTIONS = ["account", "content", "publishing", "integrations", "notifications", "billing"] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];
export type SettingsSaveAction = { onSave: () => void; isPending: boolean; disabled?: boolean };

export function SettingsShell() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const requested = params.get("tab") ?? params.get("section");
  const active = SETTINGS_SECTIONS.includes(requested as SettingsSection) ? requested as SettingsSection : "account";
  const [visited, setVisited] = useState<Set<string>>(() => new Set([active]));
  const [contentAction, setContentAction] = useState<SettingsSaveAction | null>(null);
  // Keep visited forms mounted so switching sections does not discard edits.
  useEffect(() => {
    setVisited((current) => current.has(active) ? current : new Set([...current, active]));
  }, [active]);
  function selectSection(section: string) {
    const next = new URLSearchParams(search);
    next.set("tab", section);
    next.delete("section");
    navigate(`${location}?${next.toString()}`);
  }
  return <SettingsNavigationGuard><div className="flex h-full min-w-0 flex-col overflow-hidden">
    <PageHeader title="Settings" subtitle="Manage your account, content, and publishing preferences." />
    <main className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto w-full max-w-5xl">
        <Tabs value={active} onValueChange={selectSection}>
          <TabsList aria-label="Settings sections" className="mb-6 flex h-auto w-full flex-wrap justify-start gap-1">
            {SETTINGS_SECTIONS.map((section) => <TabsTrigger key={section} value={section} className="min-h-11 capitalize" data-testid={section === "content" ? "tab-content-preferences" : `tab-${section}`}>{section}</TabsTrigger>)}
          </TabsList>
          {SETTINGS_SECTIONS.map((section) => <TabsContent key={section} value={section} forceMount className="data-[state=inactive]:hidden">
            {(visited.has(section) || section === active) && <>
              {section === "account" && <AccountSettings />}
              {section === "content" && <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Voice, interests &amp; sources</h2>{contentAction && <Button className="min-h-11" onClick={contentAction.onSave} disabled={contentAction.isPending || contentAction.disabled} data-testid="button-save-content-preferences">{contentAction.isPending ? "Saving…" : "Save Content Preferences"}</Button>}</div>
                <ProfileSettingsPage embedded onSaveActionChange={setContentAction} />
                <EditorialVoiceSettings />
              </>}
              {section === "publishing" && <PluginsPage embedded />}
              {section === "integrations" && <ConnectionsPage embedded />}
              {section === "notifications" && <NotificationSettings />}
              {section === "billing" && <BillingPage embedded />}
            </>}
          </TabsContent>)}
        </Tabs>
      </div>
    </main>
  </div></SettingsNavigationGuard>;
}