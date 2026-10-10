import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Bell, CreditCard, Plug, Share2, Sparkles, User, UserPlus, Users, type LucideIcon } from "lucide-react";
import { PageBody, PageHeader, PageToolbar } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import ProfileSettingsPage from "@/pages/profile-settings";
import PluginsPage from "@/pages/plugins";
import ConnectionsPage from "@/pages/analytics";
import BillingPage from "@/pages/billing";
import { AccountSettings } from "./account-settings";
import { NotificationSettings } from "./notification-settings";
import { SettingsNavigationGuard } from "./settings-navigation-guard";
import { EditorialVoiceSettings } from "./editorial-voice-settings";
import { InvitationSettings } from "./invitation-settings";
import { TeamSettings } from "./team-settings";

export const SETTINGS_SECTIONS = ["account", "content", "publishing", "integrations", "notifications", "billing", "invitations", "team"] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];
export type SettingsSaveAction = { onSave: () => void; isPending: boolean; disabled?: boolean };

const SECTION_ICONS: Record<SettingsSection, LucideIcon> = {
  account: User, content: Sparkles, publishing: Share2, integrations: Plug, notifications: Bell, billing: CreditCard, invitations: UserPlus, team: Users,
};

/** Desktop/tablet: a left-side list of sections, matching the app's neutral
 * hover/selected surface language. Mobile keeps the existing compact row
 * unchanged (same classes/behavior as before this redesign). */
const listItemClassName = "min-h-9 w-full justify-start gap-2 border-b-0 px-3 py-2 text-sm font-medium capitalize leading-5 text-muted-foreground hover:bg-muted hover:text-foreground data-[state=active]:border-b-0 data-[state=active]:bg-accent data-[state=active]:font-semibold data-[state=active]:text-accent-foreground";

export function SettingsShell() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const isMobile = useIsMobile();
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
  const navigation = isMobile ? (
    <PageToolbar aria-label="Settings navigation">
      <TabsList aria-label="Settings sections" className="flex h-auto w-full flex-wrap justify-start gap-1">
        {SETTINGS_SECTIONS.map((section) => <TabsTrigger key={section} value={section} className="min-h-11 capitalize" data-testid={section === "content" ? "tab-content-preferences" : `tab-${section}`}>{section === "invitations" ? "Invite friends" : section}</TabsTrigger>)}
      </TabsList>
    </PageToolbar>
  ) : (
    <div data-settings-nav="" className="w-56 shrink-0">
      <TabsList aria-label="Settings sections" className="flex h-auto w-full flex-col gap-1 bg-transparent p-0 text-muted-foreground">
        {SETTINGS_SECTIONS.map((section) => {
          const Icon = SECTION_ICONS[section];
          return <TabsTrigger key={section} value={section} className={listItemClassName} data-testid={section === "content" ? "tab-content-preferences" : `tab-${section}`}>
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" /><span>{section === "invitations" ? "Invite friends" : section}</span>
          </TabsTrigger>;
        })}
      </TabsList>
    </div>
  );
  return <SettingsNavigationGuard><main className="flex h-full min-w-0 flex-col overflow-hidden">
    <PageHeader width="standard" title="Settings" help="Manage your account, content, and publishing preferences." />
    <PageBody as="div" width="standard">
        <Tabs value={active} onValueChange={selectSection} orientation={isMobile ? "horizontal" : "vertical"} className={cn("flex min-w-0 flex-col gap-6", !isMobile && "md:flex-row md:items-start")}>
          {navigation}
          <div className="min-w-0 flex-1">
            {SETTINGS_SECTIONS.map((section) => <TabsContent key={section} value={section} forceMount className="mt-0 data-[state=inactive]:hidden">
              {(visited.has(section) || section === active) && <>
                {section === "account" && <AccountSettings />}
                {section === "content" && <>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Voice, interests &amp; sources</h2>{contentAction && <Button onClick={contentAction.onSave} disabled={contentAction.isPending || contentAction.disabled} data-testid="button-save-content-preferences">{contentAction.isPending ? "Saving…" : "Save Content Preferences"}</Button>}</div>
                  <ProfileSettingsPage embedded onSaveActionChange={setContentAction} />
                  <EditorialVoiceSettings />
                </>}
                {section === "publishing" && <PluginsPage embedded />}
                {section === "integrations" && <ConnectionsPage embedded />}
                {section === "notifications" && <NotificationSettings />}
                {section === "billing" && <BillingPage embedded />}
                {section === "invitations" && <InvitationSettings />}
                {section === "team" && <TeamSettings />}
              </>}
            </TabsContent>)}
          </div>
        </Tabs>
    </PageBody>
  </main></SettingsNavigationGuard>;
}