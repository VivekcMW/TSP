import { useId, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { ToastAction } from "@/components/ui/toast";
import { CalibrationDialog } from "@/components/inbox/calibration-dialog";
import { CREATE_TONES } from "@/components/dashboard/create-post-state";
import { useToast } from "@/hooks/use-toast";
import { useIsSignedIn } from "@/lib/dev-auth";
import {
  changeFeedPreferences, FEED_PREFERENCES_KEY, resetFeedPreferences, setPostUndoSeconds, storeDensity, storeReadingPane, undoneToast, useDensity, useReadingPane,
  type InboxDensity, type ReadingPane,
} from "@/lib/inbox-feedback";
import { readUndoSeconds, UNDO_WINDOW_OPTIONS } from "@/lib/linkedin-compose";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { EmailPreferenceValues } from "@shared/email-preferences";
import type { FeedPreferencesView, UserProfile } from "@shared/schema";

const PROFILE_KEY = ["/api/profile"] as const;
const EMAIL_KEY = ["/api/email-preferences"] as const;
type ProfilePatch = Partial<Pick<UserProfile, "defaultTone" | "requirePublishReview">>;
const errorText = (error: unknown) => error instanceof Error && error.message ? error.message : "Try again.";

/** Applies the change at once and rolls it back (with a toast) if the server refuses it. */
function useInstantSave<T extends object>(key: readonly string[], url: string, label: string) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (patch: Partial<T>): Promise<T> => (await apiRequest("PATCH", url, patch)).json(),
    onMutate: async (patch: Partial<T>) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<T>(key);
      if (previous) queryClient.setQueryData<T>(key, { ...previous, ...patch });
      return { previous };
    },
    onSuccess: saved => queryClient.setQueryData<T>(key, current => ({ ...current, ...saved }) as T),
    onError: (error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast({ title: `Couldn't save ${label}`, description: errorText(error), variant: "destructive" });
    },
  });
}

/** Gmail-style quick settings: display, posting and what the feed has learned. Everything saves immediately. */
export function QuickSettingsPanel() {
  const signedIn = Boolean(useIsSignedIn());
  const density = useDensity();
  const pane = useReadingPane();
  const [undoSeconds, setUndoSeconds] = useState(readUndoSeconds);
  const [tuning, setTuning] = useState(false);
  const profile = useQuery<UserProfile>({ queryKey: PROFILE_KEY, enabled: signedIn });
  const email = useQuery<EmailPreferenceValues>({ queryKey: EMAIL_KEY, enabled: signedIn });
  const saveProfile = useInstantSave<UserProfile>(PROFILE_KEY, "/api/profile", "the setting");
  const saveEmail = useInstantSave<EmailPreferenceValues>(EMAIL_KEY, "/api/email-preferences", "the email setting");
  const toneId = useId();
  const reviewId = useId();
  const digestId = useId();
  const patchProfile = (patch: ProfilePatch) => saveProfile.mutate(patch);

  return <div className="space-y-5" data-testid="quick-settings">
    <Section title="Density">
      <Choices label="Density" value={density} onChange={value => storeDensity(value as InboxDensity)} options={[["comfortable", "Comfortable"], ["compact", "Compact"]]} />
    </Section>
    <Section title="Reading pane">
      <Choices label="Reading pane" value={pane} onChange={value => storeReadingPane(value as ReadingPane)} options={[["right", "Right of list"], ["off", "Off"]]} />
      <p className="text-xs text-muted-foreground">Off shows the list only; open a story to read it.</p>
    </Section>
    <Section title="Undo window for posts">
      <Choices label="Undo window for posts" value={String(undoSeconds)} onChange={value => { setPostUndoSeconds(Number(value)); setUndoSeconds(Number(value)); }}
        options={UNDO_WINDOW_OPTIONS.map(seconds => [String(seconds), `${seconds}s`])} />
      <p className="text-xs text-muted-foreground">Time to undo after you press Post.</p>
    </Section>
    <Section title="Posting">
      <label htmlFor={toneId} className="block text-sm">Default tone</label>
      <select id={toneId} value={profile.data?.defaultTone ?? "professional"} disabled={!profile.data} onChange={event => patchProfile({ defaultTone: event.target.value })}
        className="h-10 w-full rounded-md border bg-card px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" data-testid="select-default-tone">
        {CREATE_TONES.map(tone => <option key={tone.value} value={tone.value}>{tone.label}</option>)}
      </select>
      <SwitchRow id={reviewId} label="Review before posting" hint="Approve each post before it goes to LinkedIn." checked={profile.data?.requirePublishReview ?? true}
        disabled={!profile.data} onChange={checked => patchProfile({ requirePublishReview: checked })} />
    </Section>
    <Section title="Email">
      <SwitchRow id={digestId} label="Daily digest email" hint="A short email with new stories for you." checked={email.data?.dailyDigest ?? false}
        disabled={!email.data} onChange={checked => saveEmail.mutate({ dailyDigest: checked })} />
      {email.isError && <p role="alert" className="text-xs text-muted-foreground">Email settings could not be loaded.</p>}
    </Section>
    <Section title="Your feed">
      <Button variant="outline" className="w-full" onClick={() => setTuning(true)} data-testid="button-tune-feed">Tune your feed (30 seconds)</Button>
      <LearnedList signedIn={signedIn} />
    </Section>
    <Button asChild variant="outline" className="w-full"><Link href="/dashboard/settings">See all settings</Link></Button>
    <CalibrationDialog open={tuning} onOpenChange={setTuning} />
  </div>;
}

function Section({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return <section className="space-y-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>{children}</section>;
}

function Choices({ label, value, options, onChange }: Readonly<{ label: string; value: string; options: ReadonlyArray<readonly [string, string]>; onChange: (value: string) => void }>) {
  return <SegmentedControl aria-label={label} className="w-full">
    {options.map(([id, text]) => <SegmentedControlItem key={id} selected={value === id} className="flex-1" onClick={() => onChange(id)}>{text}</SegmentedControlItem>)}
  </SegmentedControl>;
}

function SwitchRow({ id, label, hint, checked, disabled, onChange }: Readonly<{ id: string; label: string; hint: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }>) {
  return <div className="flex items-start justify-between gap-3 py-1">
    <div className="min-w-0"><label htmlFor={id} className="text-sm">{label}</label><p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p></div>
    <Switch id={id} checked={checked} disabled={disabled} aria-describedby={`${id}-hint`} onCheckedChange={onChange} />
  </div>;
}

/** "What we've learned": remove one item, or reset all (with Undo). */
function LearnedList({ signedIn }: Readonly<{ signedIn: boolean }>) {
  const { toast } = useToast();
  const learned = useQuery<FeedPreferencesView>({ queryKey: FEED_PREFERENCES_KEY, enabled: signedIn, retry: false });
  const failed = (title: string) => (error: unknown) => toast({ title, description: errorText(error), variant: "destructive" });
  const remove = useMutation({ mutationFn: changeFeedPreferences, onError: failed("Couldn't remove that") });
  const undoReset = useMutation({
    mutationFn: changeFeedPreferences,
    onSuccess: ({ skipped }) => toast(undoneToast(skipped, "Reset undone")),
    onError: failed("Couldn't undo the reset"),
  });
  // Undo restores what the server cleared (not this tab's cache), without wiping anything learned since.
  const reset = useMutation({
    mutationFn: resetFeedPreferences,
    onSuccess: ({ undo }) => {
      const cleared = Object.keys(undo.keywords).length + Object.keys(undo.sources).length > 0;
      toast({ title: "Your feed preferences were reset", ...(cleared ? { action: <ToastAction altText="Undo" onClick={() => undoReset.mutate({ restore: undo })}>Undo</ToastAction> } : {}) });
    },
    onError: failed("Couldn't reset your feed"),
  });
  const items = [
    ...(learned.data?.mutedSources ?? []).map(source => ({ key: `s:${source}`, text: `Muted ${source}`, remove: `Unmute ${source}`, body: { unmuteSource: source } })),
    ...Object.entries(learned.data?.keywordAdjustments ?? {}).sort(([a], [b]) => a.localeCompare(b))
      .map(([keyword, delta]) => ({ key: `k:${keyword}`, text: `${delta > 0 ? "More" : "Less"} about ${keyword}`, remove: `Reset ${keyword}`, body: { resetKeyword: keyword } })),
  ];
  return <div className="space-y-2" data-testid="learned-list">
    <h4 className="text-sm font-medium">What we’ve learned</h4>
    {learned.isLoading ? <p className="text-xs text-muted-foreground">Loading…</p>
      : learned.isError ? <div role="alert" className="text-xs"><p>This could not be loaded.</p><Button size="sm" variant="outline" className="mt-2" onClick={() => void learned.refetch()}>Try again</Button></div>
      : items.length ? <>
        <ul className="divide-y rounded-md border" aria-label="What we’ve learned">{items.map(item => <li key={item.key} className="flex min-h-10 items-center gap-2 pl-3 pr-1 text-sm">
          <span className="min-w-0 flex-1 break-words">{item.text}</span>
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label={item.remove} disabled={remove.isPending} onClick={() => remove.mutate(item.body)}><X className="h-4 w-4" aria-hidden="true" /></Button>
        </li>)}</ul>
        <Button variant="ghost" size="sm" disabled={reset.isPending} onClick={() => reset.mutate()}>Reset all</Button>
      </>
      : <p className="text-xs text-muted-foreground">Nothing yet. Tell us why a story isn’t relevant, or tune your feed.</p>}
  </div>;
}
