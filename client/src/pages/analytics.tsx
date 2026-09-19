import { RefreshCw, Link2, Unlink, MessageSquare, HelpCircle, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SiX } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent as BaseDialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input as BaseInput } from "@/components/ui/input";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useState, useId } from "react";
import type { ComponentType, ComponentProps } from "react";
import { useLocation, useSearch } from "wouter";
import { PageHeader } from "@/components/dashboard/page-header";
import type { SettingsPageProps } from "@/components/settings/settings-page-props";
import { getPlatformMeta, PLATFORMS } from "@/lib/platforms";
import { DIRECT_PUBLISH_PLATFORMS, publishingCapability } from "@shared/publishing-capabilities";

function Input(props: Readonly<ComponentProps<typeof BaseInput>>) {
  const id = useId();
  return <label htmlFor={id} className="space-y-2 text-sm font-medium"><span className="block">{props["aria-label"] ?? props.placeholder}</span><BaseInput {...props} id={id} className={`min-h-11 ${props.className ?? ""}`} /></label>;
}

function DialogContent(props: Readonly<ComponentProps<typeof BaseDialogContent>>) {
  return <BaseDialogContent {...props} className={`[&_button]:min-h-11 [&_button]:min-w-11 ${props.className ?? ""}`} />;
}

interface AnalyticsSummary {
  connected: {
    linkedin: boolean;
    twitter: boolean;
  };
  combined: {
    followers: number;
    following: number;
    posts: number;
    impressions: number;
    engagements: number;
    engagementRate: number;
    likes: number;
    comments: number;
    shares: number;
    clicks: number;
  };
  linkedin: {
    account: { name: string; handle: string; lastSync: string };
    metrics: Record<string, number>;
    topPosts: Array<{
      postId: string;
      content: string;
      impressions: number;
      engagements: number;
      likes: number;
      comments: number;
      shares: number;
      postedAt: string;
    }>;
  } | null;
  twitter: {
    account: { name: string; handle: string; lastSync: string };
    metrics: Record<string, number>;
    topPosts: Array<{
      postId: string;
      content: string;
      impressions: number;
      engagements: number;
      likes: number;
      comments: number;
      shares: number;
      postedAt: string;
    }>;
  } | null;
  lastSync: string | null;
}

interface IntegrationStatus {
  connected: boolean;
  assessment?: { status: string; reason?: string; requiresRefresh?: boolean };
  instance?: { accountName?: string; accountHandle?: string } | null;
}

interface PlatformGuide {
  description: string;
  steps: string[];
  links: Array<{ label: string; url: string }>;
}

const PLATFORM_GUIDES: Record<string, PlatformGuide> = {
  linkedin: {
    description: "Connect your LinkedIn account via OAuth to publish posts directly from TheSocialPundit.",
    steps: [
      "Click Connect on the LinkedIn card.",
      "Sign in to LinkedIn when prompted and approve the requested permissions.",
      "You'll be redirected back here, connected and ready to publish.",
      "Use Sync any time to refresh your account details.",
    ],
    links: [{ label: "LinkedIn", url: "https://www.linkedin.com/" }],
  },
  twitter: {
    description: "Connect your X (Twitter) account via OAuth 2.0 to publish posts directly.",
    steps: [
      "Click Connect on the Twitter/X card.",
      "Sign in to X when prompted and authorize the app.",
      "You'll be redirected back here, connected and ready to publish.",
    ],
    links: [{ label: "X (Twitter)", url: "https://x.com/" }],
  },
  bluesky: {
    description: "Bluesky uses an app password (not your main password) for third-party apps like this one.",
    steps: [
      "Open Bluesky Settings → Privacy and Security → App Passwords.",
      "Create a new app password and copy it (never use your main password here).",
      "Come back here, click Connect, and paste your handle plus the app password.",
    ],
    links: [{ label: "Bluesky", url: "https://bsky.app/" }],
  },
  mastodon: {
    description: "Create a personal access token in your Mastodon instance's Development settings, then paste your instance URL and token here.",
    steps: [
      "On your Mastodon instance, go to Settings → Development → New Application.",
      "Enable the write:statuses scope and create the application.",
      "Copy the generated access token.",
      "Paste your instance URL and the token here to connect.",
    ],
    links: [{ label: "Mastodon", url: "https://joinmastodon.org/" }],
  },
  slack: {
    description: "Slack posts through an incoming webhook URL scoped to one channel.",
    steps: [
      "In Slack, open your workspace's App settings → Incoming Webhooks.",
      "Create a new webhook for the channel you want to post to.",
      "Copy the webhook URL and paste it here — we'll send a test message to confirm it works.",
    ],
    links: [{ label: "Slack", url: "https://slack.com/" }],
  },
  discord: {
    description: "Discord posts through a channel webhook URL you create in that channel's settings.",
    steps: [
      "In Discord, open the target channel's Settings → Integrations → Webhooks.",
      "Create a new webhook and copy its URL.",
      "Paste it here to connect — we'll send a test message to confirm it works.",
    ],
    links: [{ label: "Discord", url: "https://discord.com/" }],
  },
  devto: {
    description: "Generate a personal API key from your Dev.to account settings.",
    steps: [
      "Go to Dev.to Settings → Extensions.",
      "Generate a personal API key and copy it.",
      "Paste it here to connect — no OAuth sign-in needed.",
    ],
    links: [{ label: "Dev.to", url: "https://dev.to/" }],
  },
  reddit: {
    description: "Connect a Reddit account authorized to post in your target subreddit.",
    steps: [
      "Enter the subreddit you're authorized to post in.",
      "Continue to Reddit and sign in to authorize the app.",
      "You'll be redirected back here, connected and ready to publish.",
    ],
    links: [{ label: "Reddit", url: "https://www.reddit.com/" }],
  },
  threads: {
    description: "Threads doesn't support automated posting yet — open it to paste your draft manually.",
    steps: ["Copy the draft generated for Threads in TheSocialPundit.", "Click Open to launch Threads.", "Paste and post it there directly."],
    links: [{ label: "Threads", url: "https://www.threads.net/" }],
  },
  substack: {
    description: "Paste your draft into a new Substack Note.",
    steps: ["Copy the draft generated for Substack in TheSocialPundit.", "Click Open to launch Substack Notes.", "Paste and publish it there directly."],
    links: [{ label: "Substack", url: "https://substack.com/" }],
  },
  medium: {
    description: "Paste your draft into a new Medium story.",
    steps: ["Copy the draft generated for Medium in TheSocialPundit.", "Click Open to start a new Medium story.", "Paste, format, and publish it there."],
    links: [{ label: "Medium", url: "https://medium.com/" }],
  },
  hashnode: {
    description: "Generate a personal access token from your Hashnode account settings to publish directly to your default publication. Note: Hashnode now requires your publication to be on a paid Pro plan for any API access.",
    steps: [
      "Upgrade your Hashnode publication to Pro (Blog dashboard → Billing → Upgrade) — required for API access to work at all.",
      "Go to Hashnode account settings and generate a personal access token.",
      "Click Connect on the Hashnode card and paste the token.",
      "We automatically detect your default publication so posts publish there.",
    ],
    links: [{ label: "Hashnode", url: "https://hashnode.com/" }],
  },
  quora: {
    description: "Quora content works best as an answer, not a generic post — adapt your draft before pasting.",
    steps: ["Find or search for a relevant question on Quora.", "Copy the draft generated for Quora and adapt it into an answer.", "Paste and submit your answer there."],
    links: [{ label: "Quora", url: "https://www.quora.com/" }],
  },
  facebook: {
    description: "Paste your draft into a new Facebook post.",
    steps: ["Copy the draft generated for Facebook in TheSocialPundit.", "Click Open to go to Facebook.", "Paste and publish it there directly."],
    links: [{ label: "Facebook", url: "https://www.facebook.com/" }],
  },
  telegram: {
    description: "Connect a Telegram bot to publish directly to a channel or group — no more copy & paste.",
    steps: [
      "Message @BotFather on Telegram and use /newbot to create a bot, then copy its token.",
      "Add your bot as an admin of the channel or group you want to post to.",
      "Find the chat ID (for public channels, @yourchannelname works; for private chats, forward a message to @userinfobot to get the numeric ID).",
      "Paste both here to connect — we send a real test message to confirm it works.",
    ],
    links: [{ label: "Telegram", url: "https://telegram.org/" }, { label: "@BotFather", url: "https://t.me/BotFather" }],
  },
  farcaster: {
    description: "Paste your draft into a new Farcaster cast via Warpcast.",
    steps: ["Copy the draft generated for Farcaster in TheSocialPundit.", "Click Open to launch Warpcast's compose window.", "Paste and cast it there directly."],
    links: [{ label: "Farcaster", url: "https://www.farcaster.xyz/" }],
  },
  xiaohongshu: {
    description: "Paste your draft into a new Xiaohongshu (RedNote) post.",
    steps: ["Copy the draft generated for Xiaohongshu in TheSocialPundit.", "Click Open to go to Xiaohongshu.", "Paste and publish it there directly."],
    links: [{ label: "Xiaohongshu", url: "https://www.xiaohongshu.com/" }],
  },
  weibo: {
    description: "Paste your draft into a new Weibo post.",
    steps: ["Copy the draft generated for Weibo in TheSocialPundit.", "Click Open to go to Weibo.", "Paste and publish it there directly."],
    links: [{ label: "Weibo", url: "https://weibo.com/" }],
  },
  wechat: {
    description: "Paste your draft into WeChat's official account publishing platform.",
    steps: ["Copy the draft generated for WeChat in TheSocialPundit.", "Click Open to go to WeChat Official Accounts.", "Paste it into a new article and publish."],
    links: [{ label: "WeChat", url: "https://www.wechat.com/" }],
  },
  maimai: {
    description: "Paste your draft into a new Maimai post.",
    steps: ["Copy the draft generated for Maimai in TheSocialPundit.", "Click Open to go to Maimai.", "Paste and publish it there directly."],
    links: [{ label: "Maimai", url: "https://maimai.cn/" }],
  },
  vk: {
    description: "Paste your draft into a new VK post.",
    steps: ["Copy the draft generated for VK in TheSocialPundit.", "Click Open to go to VK.", "Paste and publish it there directly."],
    links: [{ label: "VK", url: "https://vk.com/" }],
  },
  line: {
    description: "Share your draft into a LINE chat or Timeline post.",
    steps: ["Copy the draft generated for LINE in TheSocialPundit.", "Open the LINE app.", "Paste it into a chat or Timeline post and send."],
    links: [{ label: "LINE", url: "https://line.me/" }],
  },
  naver: {
    description: "Paste your draft into a new Naver Blog post.",
    steps: ["Copy the draft generated for Naver Blog in TheSocialPundit.", "Click Open to start a new Naver Blog post.", "Paste and publish it there directly."],
    links: [{ label: "Naver Blog", url: "https://blog.naver.com/" }],
  },
  xing: {
    description: "Paste your draft into a new Xing post.",
    steps: ["Copy the draft generated for Xing in TheSocialPundit.", "Click Open to go to Xing.", "Paste and publish it there directly."],
    links: [{ label: "Xing", url: "https://www.xing.com/" }],
  },
};

function PlatformGuideSheet({ platformKey, label, onOpenChange }: { platformKey: string | null; label: string; onOpenChange: (open: boolean) => void }) {
  const guide = platformKey ? PLATFORM_GUIDES[platformKey] : undefined;
  return (
    <Sheet open={Boolean(platformKey)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[500px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{label} guide</SheetTitle>
          <SheetDescription>{guide?.description}</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          <div>
            <p className="mb-2 text-sm font-medium">How to use it</p>
            <ol className="space-y-2">
              {guide?.steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-xs font-medium text-secondary">{index + 1}</span>
                  <span className="text-muted-foreground">{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Helpful links</p>
            <div className="space-y-2">
              {guide?.links.map((link) => (
                <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-card px-3 py-2 text-sm hover-elevate">
                  <span>{link.label}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PlatformRow({
  label,
  description,
  icon: Icon,
  connected,
  needsAttention,
  onConnect,
  onDisconnect,
  onSync,
  onGuide,
  isConnecting,
  isDisconnecting,
  isSyncing,
  statusKnown = true,
  testId,
}: {
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  connected: boolean;
  needsAttention?: boolean;
  onConnect: () => void;
  onDisconnect?: () => void;
  onSync?: () => void;
  onGuide: () => void;
  isConnecting?: boolean;
  isDisconnecting?: boolean;
  isSyncing?: boolean;
  statusKnown?: boolean;
  testId: string;
}) {
  return (
    <Card className="border-border/70 shadow-sm hover-elevate" data-testid={`card-connection-${testId}`}>
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary/15">
          <Icon className="h-5 w-5 text-secondary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium">{label}</p>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${needsAttention ? "bg-destructive" : connected ? "bg-success" : "bg-muted-foreground/40"}`} />
          </div>
          <p className="break-words text-sm text-muted-foreground">{statusKnown ? description : "Connection status unavailable"}</p>
          <p className="text-xs text-muted-foreground">{publishingCapability(testId)?.maxMedia ? `Media: up to ${publishingCapability(testId)!.maxMedia} attachments; type and size limits checked before delivery.` : "Text-only publishing; attachments are not supported."} {publishingCapability(testId)?.receipt === "unavailable" ? "Delivery receipt unavailable; acceptance is not verified publication." : "Live publication requires a provider post ID."}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 [&_button]:min-h-11 [&_button]:min-w-11">
          <Button variant="ghost" size="icon" className="h-11 w-11" onClick={onGuide} aria-label={`${label} guide`} title={`${label} guide`}>
            <HelpCircle className="h-4 w-4" />
          </Button>
          {connected && onSync && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onSync} disabled={isSyncing} aria-label={`Sync ${label}`} title={`Sync ${label}`}>
              <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
            </Button>
          )}
          {connected ? (
            <Button variant="outline" size="sm" onClick={onDisconnect} disabled={isDisconnecting} data-testid={`button-disconnect-${testId}`}>
              <Unlink className="mr-2 h-4 w-4" />
              Disconnect
            </Button>
          ) : (
            <Button size="sm" onClick={onConnect} disabled={isConnecting || !statusKnown} data-testid={`button-connect-${testId}`}>
              <Link2 className="mr-2 h-4 w-4" />
              {!statusKnown ? "Unavailable" : needsAttention ? "Reconnect" : "Connect"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

const MANUAL_PLATFORM_CATEGORIES: Array<{ label: string; platforms: string[] }> = [
  { label: "Blogging & long-form", platforms: ["substack", "medium", "quora"] },
  { label: "Social", platforms: ["threads", "facebook", "farcaster", "xiaohongshu", "weibo"] },
  { label: "Messaging", platforms: ["wechat", "line"] },
  { label: "Professional & regional", platforms: ["maimai", "vk", "naver", "xing"] },
];

function ManualPlatformRow({ platform, onGuide }: { platform: ReturnType<typeof getPlatformMeta>; onGuide: () => void }) {
  const Icon = platform.icon;

  return (
    <Card className="border-border/70 shadow-sm hover-elevate" data-testid={`card-connection-${platform.value}`}>
      <CardContent className="flex flex-wrap items-center gap-4 p-4 [&_button]:min-h-11 [&_button]:min-w-11">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary/15">
          <Icon className="h-5 w-5 text-secondary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{platform.label}</p>
          <p className="truncate text-sm text-muted-foreground">Opens in a new tab to paste a draft manually</p>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onGuide} aria-label={`${platform.label} guide`} title={`${platform.label} guide`}>
          <HelpCircle className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.open(platform.composeUrl(""), "_blank", "noopener,noreferrer")} data-testid={`button-connect-${platform.value}`}>
          Open
        </Button>
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage({ embedded = false }: SettingsPageProps = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location, navigate] = useLocation();
  const Body = embedded ? "div" : "main";
  const searchString = useSearch();
  const [discordOpen, setDiscordOpen] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookProvider, setWebhookProvider] = useState("discord");
  const [devToOpen, setDevToOpen] = useState(false);
  const [devToKey, setDevToKey] = useState("");
  const [hashnodeOpen, setHashnodeOpen] = useState(false);
  const [hashnodeToken, setHashnodeToken] = useState("");
  const [blueskyOpen, setBlueskyOpen] = useState(false);
  const [blueskyHandle, setBlueskyHandle] = useState("");
  const [blueskyAppPassword, setBlueskyAppPassword] = useState("");
  const [mastodonOpen, setMastodonOpen] = useState(false);
  const [mastodonInstanceUrl, setMastodonInstanceUrl] = useState("");
  const [mastodonAccessToken, setMastodonAccessToken] = useState("");
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [redditOpen, setRedditOpen] = useState(false);
  const [subreddit, setSubreddit] = useState("");
  const [showManualPlatforms, setShowManualPlatforms] = useState(false);
  const [guideKey, setGuideKey] = useState<string | null>(null);

  const { data: summary, isLoading, isError, refetch } = useQuery<AnalyticsSummary>({
    queryKey: ['/api/analytics/summary'],
  });
  const providers = ["linkedin", "discord", "slack", "devto", "hashnode", "bluesky", "mastodon", "telegram", "reddit"];
  const statusQueries = useQueries({ queries: providers.map((provider) => ({ queryKey: [`/api/integrations/${provider}/status`], queryFn: async (): Promise<IntegrationStatus> => (await apiRequest("GET", `/api/integrations/${provider}/status`)).json() })) });
  const [linkedinStatus, discordStatus, slackStatus, devToStatus, hashnodeStatus, blueskyStatus, mastodonStatus, telegramStatus, redditStatus] = statusQueries.map((query) => query.data);
  const refetchProvider = (provider: string) => queryClient.invalidateQueries({ queryKey: [`/api/integrations/${provider}/status`] });
  const refetchDevTo = () => refetchProvider("devto");
  const refetchHashnode = () => refetchProvider("hashnode");
  const refetchBluesky = () => refetchProvider("bluesky");
  const refetchMastodon = () => refetchProvider("mastodon");
  const refetchTelegram = () => refetchProvider("telegram");

  // Handle OAuth callback URL parameters
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const connected = params.get('connected');
    const error = params.get('error');
    
    if (connected) {
      refetch();
      void queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/integrations/") });
      toast({
        title: "Account Connected",
        description: `Your ${connected} account has been connected successfully.`,
      });
    }
    
    if (error) {
      toast({
        title: "Connection Failed",
        description: "Failed to connect account. Please try again.",
        variant: "destructive",
      });
    }
    if (connected || error) {
      params.delete("connected");
      params.delete("error");
      navigate(`${location}${params.size ? `?${params.toString()}` : ""}`, { replace: true });
    }
  }, [searchString, toast, refetch, queryClient, location, navigate]);

  // Connect LinkedIn via OAuth redirect
  const handleLinkedInConnect = () => {
    window.location.href = '/auth/linkedin/analytics';
  };

  // Connect X via real OAuth 2.0 + PKCE redirect
  const handleTwitterConnect = () => {
    window.location.href = '/auth/twitter/connect';
  };

  const disconnectMutation = useMutation({
    mutationFn: async (provider: string) => {
      return apiRequest('DELETE', `/api/social/disconnect/${provider}`);
    },
    onSuccess: (_, provider) => {
      queryClient.invalidateQueries({ queryKey: ['/api/analytics/summary'] });
      void refetchProvider(provider);
      toast({
        title: "Account Disconnected",
        description: `Your ${provider} account has been disconnected.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Disconnection Failed",
        description: error.message || "Failed to disconnect account.",
        variant: "destructive",
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (provider: string) => {
      return apiRequest('POST', `/api/social/sync/${provider}`);
    },
    onSuccess: (_, provider) => {
      queryClient.invalidateQueries({ queryKey: ['/api/analytics/summary'] });
      toast({
        title: "Sync Complete",
        description: `Your ${provider} analytics have been updated.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync analytics.",
        variant: "destructive",
      });
    },
  });

  const discordMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/integrations/${webhookProvider}/webhook`, { webhookUrl })).json(),
    onSuccess: () => {
      setWebhookUrl("");
      setDiscordOpen(false);
      void refetchProvider(webhookProvider);
      toast({ title: "Webhook connected", description: "A test message was delivered to your channel." });
    },
    onError: (error: Error) => toast({ title: "Webhook connection failed", description: error.message, variant: "destructive" }),
  });
  const devToMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/integrations/devto/api-key", { apiKey: devToKey })).json(),
    onSuccess: () => {
      setDevToKey("");
      setDevToOpen(false);
      refetchDevTo();
      toast({ title: "Dev.to connected", description: "Your API key is encrypted and ready for publishing." });
    },
    onError: (error: Error) => toast({ title: "Dev.to connection failed", description: error.message, variant: "destructive" }),
  });
  const hashnodeMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/integrations/hashnode/personal-access-token", { personalAccessToken: hashnodeToken })).json(),
    onSuccess: () => {
      setHashnodeToken("");
      setHashnodeOpen(false);
      refetchHashnode();
      toast({ title: "Hashnode connected", description: "Your personal access token is encrypted and ready for publishing." });
    },
    onError: (error: Error) => toast({ title: "Hashnode connection failed", description: error.message, variant: "destructive" }),
  });
  const blueskyMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/integrations/bluesky/app-password", { handle: blueskyHandle, appPassword: blueskyAppPassword })).json(),
    onSuccess: () => { setBlueskyAppPassword(""); setBlueskyOpen(false); refetchBluesky(); toast({ title: "Bluesky connected", description: "Your app password is encrypted and ready for publishing." }); },
    onError: (error: Error) => toast({ title: "Bluesky connection failed", description: error.message, variant: "destructive" }),
  });
  const mastodonMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/integrations/mastodon/access-token", { instanceUrl: mastodonInstanceUrl, accessToken: mastodonAccessToken })).json(),
    onSuccess: () => { setMastodonAccessToken(""); setMastodonOpen(false); refetchMastodon(); toast({ title: "Mastodon connected", description: "Your access token is encrypted and ready for publishing." }); },
    onError: (error: Error) => toast({ title: "Mastodon connection failed", description: error.message, variant: "destructive" }),
  });
  const telegramMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/integrations/telegram/bot-token", { botToken: telegramBotToken, chatId: telegramChatId })).json(),
    onSuccess: () => { setTelegramBotToken(""); setTelegramChatId(""); setTelegramOpen(false); refetchTelegram(); toast({ title: "Telegram connected", description: "A test message was delivered to your chat." }); },
    onError: (error: Error) => toast({ title: "Telegram connection failed", description: error.message, variant: "destructive" }),
  });

  // Implemented adapters are visible; connection/global readiness remains a
  // separate check, not a hardcoded assumption about deployment secrets.
  const READY_FOR_STAGING = new Set<string>(DIRECT_PUBLISH_PLATFORMS);
  const connectedAccountPlatforms = new Set<string>(DIRECT_PUBLISH_PLATFORMS);
  const manualPublishingPlatforms = PLATFORMS.filter((platform) => !connectedAccountPlatforms.has(platform.value));
  const manualPlatformCategories = MANUAL_PLATFORM_CATEGORIES.map((category) => ({
    label: category.label,
    platforms: category.platforms.map((value) => getPlatformMeta(value)),
  })).filter((category) => category.platforms.length > 0);

  function needsAttention(status?: IntegrationStatus): boolean {
    return status?.assessment?.status === "invalid" || status?.assessment?.status === "expired";
  }

  const platformRows = [
    {
      key: "linkedin",
      label: "LinkedIn",
      icon: FaLinkedin,
      connected: Boolean(linkedinStatus?.connected),
      needsAttention: needsAttention(linkedinStatus),
      description: summary?.connected.linkedin && summary.linkedin?.account ? `${summary.linkedin.account.name} (${summary.linkedin.account.handle})` : "OAuth connection for direct publishing",
      onConnect: handleLinkedInConnect,
      onDisconnect: () => disconnectMutation.mutate("linkedin"),
      onSync: () => syncMutation.mutate("linkedin"),
      isDisconnecting: disconnectMutation.isPending && disconnectMutation.variables === "linkedin",
      isSyncing: syncMutation.isPending && syncMutation.variables === "linkedin",
    },
    {
      key: "twitter",
      label: "Twitter/X",
      icon: SiX,
      connected: Boolean(summary?.connected.twitter),
      description: summary?.connected.twitter && summary.twitter?.account ? `${summary.twitter.account.name} (${summary.twitter.account.handle})` : "OAuth connection for direct publishing",
      onConnect: handleTwitterConnect,
      onDisconnect: () => disconnectMutation.mutate("twitter"),
      isDisconnecting: disconnectMutation.isPending && disconnectMutation.variables === "twitter",
    },
    {
      key: "bluesky",
      label: "Bluesky",
      icon: getPlatformMeta("bluesky").icon,
      connected: Boolean(blueskyStatus?.connected),
      needsAttention: needsAttention(blueskyStatus),
      description: blueskyStatus?.connected ? "App password connected" : "Connect with a Bluesky app password",
      onConnect: () => setBlueskyOpen(true),
      onDisconnect: () => disconnectMutation.mutate("bluesky"),
      isDisconnecting: disconnectMutation.isPending && disconnectMutation.variables === "bluesky",
    },
    {
      key: "mastodon",
      label: "Mastodon",
      icon: getPlatformMeta("mastodon").icon,
      connected: Boolean(mastodonStatus?.connected),
      needsAttention: needsAttention(mastodonStatus),
      description: mastodonStatus?.connected ? "Instance access token connected" : "Connect a Mastodon instance",
      onConnect: () => setMastodonOpen(true),
      onDisconnect: () => disconnectMutation.mutate("mastodon"),
      isDisconnecting: disconnectMutation.isPending && disconnectMutation.variables === "mastodon",
    },
    {
      key: "telegram",
      label: "Telegram",
      icon: getPlatformMeta("telegram").icon,
      connected: Boolean(telegramStatus?.connected),
      needsAttention: needsAttention(telegramStatus),
      description: telegramStatus?.connected ? `Connected to ${telegramStatus.instance?.accountName || "your chat"}` : "Connect a bot to a channel or group",
      onConnect: () => setTelegramOpen(true),
      onDisconnect: () => disconnectMutation.mutate("telegram"),
      isDisconnecting: disconnectMutation.isPending && disconnectMutation.variables === "telegram",
    },
    {
      key: "slack",
      label: "Slack",
      icon: MessageSquare,
      connected: Boolean(slackStatus?.connected),
      needsAttention: needsAttention(slackStatus),
      description: slackStatus?.connected ? "Incoming webhook connected" : "Connect an incoming webhook",
      onConnect: () => { setWebhookProvider("slack"); setDiscordOpen(true); },
      onDisconnect: () => disconnectMutation.mutate("slack"),
      isDisconnecting: disconnectMutation.isPending && disconnectMutation.variables === "slack",
    },
    {
      key: "discord",
      label: "Discord",
      icon: getPlatformMeta("discord").icon,
      connected: Boolean(discordStatus?.connected),
      needsAttention: needsAttention(discordStatus),
      description: discordStatus?.connected ? "Channel webhook connected" : "Connect a channel webhook",
      onConnect: () => { setWebhookProvider("discord"); setDiscordOpen(true); },
      onDisconnect: () => disconnectMutation.mutate("discord"),
      isDisconnecting: disconnectMutation.isPending && disconnectMutation.variables === "discord",
    },
    {
      key: "devto",
      label: "Dev.to",
      icon: getPlatformMeta("devto").icon,
      connected: Boolean(devToStatus?.connected),
      needsAttention: needsAttention(devToStatus),
      description: devToStatus?.connected ? "Personal API key connected" : "Connect your personal API key",
      onConnect: () => setDevToOpen(true),
      onDisconnect: () => disconnectMutation.mutate("devto"),
      isDisconnecting: disconnectMutation.isPending && disconnectMutation.variables === "devto",
    },
    {
      key: "hashnode",
      label: "Hashnode",
      icon: getPlatformMeta("hashnode").icon,
      connected: Boolean(hashnodeStatus?.connected),
      needsAttention: needsAttention(hashnodeStatus),
      description: hashnodeStatus?.connected ? "Personal access token connected" : "Connect your personal access token",
      onConnect: () => setHashnodeOpen(true),
      onDisconnect: () => disconnectMutation.mutate("hashnode"),
      isDisconnecting: disconnectMutation.isPending && disconnectMutation.variables === "hashnode",
    },
    ...(READY_FOR_STAGING.has("reddit") ? [{
      key: "reddit",
      label: "Reddit",
      icon: getPlatformMeta("reddit").icon,
      connected: Boolean(redditStatus?.connected),
      needsAttention: needsAttention(redditStatus),
      description: redditStatus?.connected ? `Connected to r/${redditStatus.instance?.accountHandle}` : "Connect a posting account",
      onConnect: () => setRedditOpen(true),
      onDisconnect: () => disconnectMutation.mutate("reddit"),
      isDisconnecting: disconnectMutation.isPending && disconnectMutation.variables === "reddit",
    }] : []),
  ];
  const rows = platformRows.map((row) => ({ ...row, statusKnown: row.key === "twitter" ? Boolean(summary) && !isError : Boolean(statusQueries[providers.indexOf(row.key)]?.data) && !statusQueries[providers.indexOf(row.key)]?.isError }));
  const connectedRows = rows.filter((row) => row.connected && row.statusKnown);
  const availableRows = rows.filter((row) => !row.connected || !row.statusKnown).map((row) => ({ ...row, connected: false }));
  const statusesUnavailable = rows.some((row) => !row.statusKnown);

  return (
    <div className={embedded ? "" : "flex flex-col h-full overflow-hidden"}>
      {!embedded && <PageHeader
        title="Connections"
        subtitle="Choose where TheSocialPundit can publish for you"
        actions={
          summary?.lastSync && (
            <p className="text-xs text-muted-foreground">
              Last synced {formatDistanceToNow(new Date(summary.lastSync), { addSuffix: true })}
            </p>
          )
        }
      />}
      
      <Body className={embedded ? "" : "flex-1 p-4 sm:p-6 overflow-y-auto"}>
        {isLoading ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-5xl space-y-6">
            {statusesUnavailable && <div role="status" className="rounded-md border p-4"><p>Some connection statuses are still loading or unavailable. They are not assumed to be disconnected.</p><Button variant="outline" className="mt-3 min-h-11" onClick={() => { void refetch(); statusQueries.forEach((query) => { void query.refetch(); }); }}>Retry connection statuses</Button></div>}
            {!statusesUnavailable && connectedRows.length === 0 && <div className="rounded-lg border border-secondary/30 bg-secondary/5 p-4"><p className="font-medium">Start with LinkedIn</p><p className="mt-1 text-sm text-muted-foreground">Connect LinkedIn to publish directly, then connect any others you use.</p></div>}

            {connectedRows.length > 0 && <section>
              <h2 className="mb-3 text-sm font-medium text-muted-foreground">Connected</h2>
              <div className="space-y-2">
                {connectedRows.map(({ key, ...row }) => <PlatformRow key={key} testId={key} {...row} onGuide={() => setGuideKey(key)} />)}
              </div>
            </section>}

            <section>
              {connectedRows.length > 0 && <h2 className="mb-3 text-sm font-medium text-muted-foreground">Available to connect</h2>}
              <div className="space-y-2">
                {availableRows.map(({ key, ...row }) => <PlatformRow key={key} testId={key} {...row} onGuide={() => setGuideKey(key)} />)}
              </div>
            </section>

            <section className="border-t pt-4">
              <button type="button" aria-expanded={showManualPlatforms} className="min-h-11 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => setShowManualPlatforms((value) => !value)}>
                {showManualPlatforms ? "Hide manual platforms" : `Show ${manualPublishingPlatforms.length} more platforms (manual copy & paste)`}
              </button>
              {showManualPlatforms && <div className="mt-4 space-y-6">
                {manualPlatformCategories.map((category) => (
                  <section key={category.label}>
                    <h2 className="mb-3 text-sm font-medium text-muted-foreground">{category.label}</h2>
                    <div className="space-y-2">{category.platforms.map((platform) => <ManualPlatformRow key={platform.value} platform={platform} onGuide={() => setGuideKey(platform.value)} />)}</div>
                  </section>
                ))}
              </div>}
            </section>
          </div>
        )}
      </Body>
      <Dialog open={discordOpen} onOpenChange={setDiscordOpen}>
        <DialogContent><DialogHeader><DialogTitle>Connect {webhookProvider[0].toUpperCase() + webhookProvider.slice(1)}</DialogTitle><DialogDescription>Paste your {webhookProvider === "slack" ? "Slack incoming" : "incoming"} webhook URL. It is encrypted at rest, and a test message validates it before saving.</DialogDescription></DialogHeader><div className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium" data-testid="text-selected-webhook-provider">{webhookProvider[0].toUpperCase() + webhookProvider.slice(1)}</div><Input type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="Paste incoming webhook URL" data-testid="input-discord-webhook" /><DialogFooter><Button variant="outline" onClick={() => setDiscordOpen(false)}>Cancel</Button><Button disabled={!webhookUrl || discordMutation.isPending} onClick={() => discordMutation.mutate()} data-testid="button-test-connect-discord">{discordMutation.isPending ? "Testing…" : "Test & connect"}</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={devToOpen} onOpenChange={setDevToOpen}>
        <DialogContent><DialogHeader><DialogTitle>Connect Dev.to</DialogTitle><DialogDescription>Paste your personal Dev.to API key. It is encrypted at rest and is never returned to the browser.</DialogDescription></DialogHeader><Input type="password" value={devToKey} onChange={(event) => setDevToKey(event.target.value)} placeholder="Dev.to API key" autoComplete="off" data-testid="input-devto-api-key" /><DialogFooter><Button variant="outline" onClick={() => setDevToOpen(false)}>Cancel</Button><Button disabled={!devToKey || devToMutation.isPending} onClick={() => devToMutation.mutate()} data-testid="button-connect-devto-key">{devToMutation.isPending ? "Connecting…" : "Connect API key"}</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={hashnodeOpen} onOpenChange={setHashnodeOpen}>
        <DialogContent><DialogHeader><DialogTitle>Connect Hashnode</DialogTitle><DialogDescription>Generate a personal access token in Hashnode account settings → Developer. It is encrypted at rest and is never returned to the browser.</DialogDescription></DialogHeader><Input type="password" value={hashnodeToken} onChange={(event) => setHashnodeToken(event.target.value)} placeholder="Hashnode personal access token" autoComplete="off" data-testid="input-hashnode-token" /><DialogFooter><Button variant="outline" onClick={() => setHashnodeOpen(false)}>Cancel</Button><Button disabled={!hashnodeToken || hashnodeMutation.isPending} onClick={() => hashnodeMutation.mutate()} data-testid="button-connect-hashnode-token">{hashnodeMutation.isPending ? "Connecting…" : "Connect token"}</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={blueskyOpen} onOpenChange={setBlueskyOpen}><DialogContent><DialogHeader><DialogTitle>Connect Bluesky</DialogTitle><DialogDescription>Create an app password in Bluesky Settings → Privacy and Security → App Passwords. Never use your normal Bluesky password.</DialogDescription></DialogHeader><Input value={blueskyHandle} onChange={(event) => setBlueskyHandle(event.target.value.trim())} placeholder="handle.bsky.social" autoComplete="username" /><Input type="password" value={blueskyAppPassword} onChange={(event) => setBlueskyAppPassword(event.target.value)} placeholder="Bluesky app password" autoComplete="off" /><DialogFooter><Button variant="outline" onClick={() => setBlueskyOpen(false)}>Cancel</Button><Button disabled={!blueskyHandle || !blueskyAppPassword || blueskyMutation.isPending} onClick={() => blueskyMutation.mutate()}>{blueskyMutation.isPending ? "Connecting…" : "Connect Bluesky"}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={mastodonOpen} onOpenChange={setMastodonOpen}><DialogContent><DialogHeader><DialogTitle>Connect Mastodon</DialogTitle><DialogDescription>Create a personal access token with the write:statuses permission in your Mastodon instance preferences. Your token is encrypted at rest.</DialogDescription></DialogHeader><Input type="url" value={mastodonInstanceUrl} onChange={(event) => setMastodonInstanceUrl(event.target.value)} placeholder="https://mastodon.social" /><Input type="password" value={mastodonAccessToken} onChange={(event) => setMastodonAccessToken(event.target.value)} placeholder="Mastodon access token" autoComplete="off" /><DialogFooter><Button variant="outline" onClick={() => setMastodonOpen(false)}>Cancel</Button><Button disabled={!mastodonInstanceUrl || !mastodonAccessToken || mastodonMutation.isPending} onClick={() => mastodonMutation.mutate()}>{mastodonMutation.isPending ? "Connecting…" : "Connect Mastodon"}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={telegramOpen} onOpenChange={setTelegramOpen}><DialogContent><DialogHeader><DialogTitle>Connect Telegram</DialogTitle><DialogDescription>Create a bot with @BotFather, add it as an admin of your channel or group, then paste its token and the chat ID here. We send a real test message to confirm it works.</DialogDescription></DialogHeader><Input type="password" value={telegramBotToken} onChange={(event) => setTelegramBotToken(event.target.value.trim())} placeholder="Bot token from @BotFather" autoComplete="off" data-testid="input-telegram-bot-token" /><Input value={telegramChatId} onChange={(event) => setTelegramChatId(event.target.value.trim())} placeholder="@yourchannel or numeric chat ID" data-testid="input-telegram-chat-id" /><DialogFooter><Button variant="outline" onClick={() => setTelegramOpen(false)}>Cancel</Button><Button disabled={!telegramBotToken || !telegramChatId || telegramMutation.isPending} onClick={() => telegramMutation.mutate()} data-testid="button-connect-telegram">{telegramMutation.isPending ? "Testing…" : "Test & connect"}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={redditOpen} onOpenChange={setRedditOpen}><DialogContent><DialogHeader><DialogTitle>Connect Reddit</DialogTitle><DialogDescription>Choose the subreddit where you are authorized to post. Reddit will ask you to approve identity and submission permissions.</DialogDescription></DialogHeader><Input value={subreddit} onChange={(event) => setSubreddit(event.target.value.replace(/^r\//, ""))} placeholder="subreddit name, e.g. yourcommunity" data-testid="input-reddit-subreddit" /><DialogFooter><Button variant="outline" onClick={() => setRedditOpen(false)}>Cancel</Button><Button disabled={!/^[A-Za-z0-9_]{3,21}$/.test(subreddit)} onClick={() => { window.location.assign(`/auth/reddit?subreddit=${encodeURIComponent(subreddit)}`); }} data-testid="button-connect-reddit-oauth">Continue to Reddit</Button></DialogFooter></DialogContent></Dialog>
      <PlatformGuideSheet platformKey={guideKey} label={(platformRows.find((row) => row.key === guideKey)?.label) || getPlatformMeta(guideKey || "").label} onOpenChange={(open) => !open && setGuideKey(null)} />
    </div>
  );
}
