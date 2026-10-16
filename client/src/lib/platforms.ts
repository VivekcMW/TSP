import { Linkedin, Briefcase, MessageSquare } from "lucide-react";
import { publishingCapability } from "@shared/publishing-capabilities";
import {
  SiX, SiThreads, SiBluesky, SiSubstack, SiMedium, SiReddit, SiMastodon, SiDevdotto, SiHashnode,
  SiQuora, SiFacebook, SiTelegram, SiDiscord, SiFarcaster, SiXiaohongshu, SiSinaweibo, SiWechat, SiVk, SiLine, SiNaver, SiXing,
} from "react-icons/si";
import type { IconType } from "react-icons";
import type { ComponentType } from "react";

export interface PlatformMeta {
  value: string;
  label: string;
  icon: ComponentType<{ className?: string }> | IconType;
  charLimit: number;
  // Best-effort destination, NOT a publishing API. Always retain a clipboard
  // fallback: login redirects and some composers can discard URL parameters.
  // LinkedIn's text query is undocumented; its official share URL is URL-only.
  composeUrl: (text: string, articleUrl?: string) => string;
}

export const PLATFORMS: PlatformMeta[] = ([
  { value: "slack", label: "Slack", icon: MessageSquare, charLimit: 4000, composeUrl: () => "https://app.slack.com/" },
  {
    value: "linkedin",
    label: "LinkedIn",
    icon: Linkedin,
    charLimit: 3000,
    composeUrl: (text) => `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`,
  },
  {
    value: "twitter",
    label: "Twitter/X",
    icon: SiX,
    charLimit: 280,
    // No raw-length cut: X counts links as 23, and the limit is enforced before this link is shown.
    composeUrl: (text) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
  },
  {
    value: "threads",
    label: "Threads",
    icon: SiThreads,
    charLimit: 500,
    composeUrl: (text) => `https://www.threads.com/intent/post?text=${encodeURIComponent(text)}`,
  },
  {
    value: "bluesky",
    label: "Bluesky",
    icon: SiBluesky,
    charLimit: 300,
    composeUrl: (text) => `https://bsky.app/intent/compose?text=${encodeURIComponent(text)}`,
  },
  {
    value: "substack",
    label: "Substack Notes",
    icon: SiSubstack,
    charLimit: 600,
    composeUrl: () => "https://substack.com/notes",
  },
  {
    value: "medium",
    label: "Medium",
    icon: SiMedium,
    charLimit: 3000,
    composeUrl: () => "https://medium.com/new-story",
  },
  {
    value: "reddit",
    label: "Reddit",
    icon: SiReddit,
    charLimit: 3000,
    composeUrl: () => "https://www.reddit.com/submit",
  },
  {
    value: "mastodon",
    label: "Mastodon",
    icon: SiMastodon,
    charLimit: 500,
    // Mastodon is federated (no single central site) — mastodon.social is a
    // reasonable best-effort default; the user's actual home instance may differ.
    composeUrl: () => "https://mastodon.social/",
  },
  {
    value: "devto",
    label: "Dev.to",
    icon: SiDevdotto,
    charLimit: 3000,
    composeUrl: () => "https://dev.to/new",
  },
  {
    value: "hashnode",
    label: "Hashnode",
    icon: SiHashnode,
    charLimit: 3000,
    composeUrl: () => "https://hashnode.com/create/story",
  },
  {
    value: "quora",
    label: "Quora",
    icon: SiQuora,
    charLimit: 5000,
    composeUrl: () => "https://www.quora.com/",
  },
  {
    value: "facebook",
    label: "Facebook",
    icon: SiFacebook,
    charLimit: 3000,
    composeUrl: () => "https://www.facebook.com/",
  },
  {
    value: "telegram",
    label: "Telegram",
    icon: SiTelegram,
    charLimit: 4000,
    composeUrl: () => "https://web.telegram.org/",
  },
  {
    value: "discord",
    label: "Discord",
    icon: SiDiscord,
    charLimit: 2000,
    composeUrl: () => "https://discord.com/channels/@me",
  },
  {
    value: "farcaster",
    label: "Farcaster",
    icon: SiFarcaster,
    charLimit: 320,
    composeUrl: (text) => `https://warpcast.com/~/compose?text=${encodeURIComponent(text)}`,
  },
  {
    value: "xiaohongshu",
    label: "Xiaohongshu",
    icon: SiXiaohongshu,
    charLimit: 1000,
    composeUrl: () => "https://www.xiaohongshu.com/",
  },
  {
    value: "weibo",
    label: "Weibo",
    icon: SiSinaweibo,
    charLimit: 2000,
    composeUrl: (text) => `https://service.weibo.com/share/share.php?title=${encodeURIComponent(text)}`,
  },
  {
    value: "wechat",
    label: "WeChat",
    icon: SiWechat,
    charLimit: 3000,
    composeUrl: () => "https://mp.weixin.qq.com/",
  },
  {
    value: "maimai",
    label: "Maimai",
    // No dedicated Simple Icons logo exists for Maimai — using a neutral
    // professional-network icon rather than fabricating a brand mark.
    icon: Briefcase,
    charLimit: 2000,
    composeUrl: () => "https://maimai.cn/",
  },
  {
    value: "vk",
    label: "VK",
    icon: SiVk,
    charLimit: 3000,
    composeUrl: (text) => `https://vk.com/share.php?title=${encodeURIComponent(text)}`,
  },
  {
    value: "line",
    label: "LINE",
    icon: SiLine,
    charLimit: 1000,
    composeUrl: (text) => `https://social-plugins.line.me/lineit/share?text=${encodeURIComponent(text)}`,
  },
  {
    value: "naver",
    label: "Naver Blog",
    icon: SiNaver,
    charLimit: 3000,
    composeUrl: () => "https://blog.naver.com/",
  },
  {
    value: "xing",
    label: "Xing",
    icon: SiXing,
    charLimit: 2000,
    composeUrl: () => "https://www.xing.com/",
  },
] satisfies PlatformMeta[]).map(platform => ({ ...platform, charLimit: publishingCapability(platform.value)?.live ? publishingCapability(platform.value)!.maxCharacters : platform.charLimit }));

/** Social networks we draft for; Slack is a team channel, not a network. */
export const SOCIAL_NETWORKS = PLATFORMS.filter(platform => platform.value !== "slack");

export function getPlatformMeta(value: string): PlatformMeta {
  return PLATFORMS.find((p) => p.value === value) ?? PLATFORMS.find(p => p.value === "linkedin")!;
}
