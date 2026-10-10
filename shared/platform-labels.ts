/** Display names for publishing platforms, as the app shows them (see client/src/lib/platforms.ts). */
export const PLATFORM_LABELS: Record<string, string> = {
  slack: "Slack", linkedin: "LinkedIn", twitter: "Twitter/X", threads: "Threads", bluesky: "Bluesky",
  substack: "Substack Notes", medium: "Medium", reddit: "Reddit", mastodon: "Mastodon", devto: "Dev.to",
  hashnode: "Hashnode", quora: "Quora", facebook: "Facebook", telegram: "Telegram", discord: "Discord",
  farcaster: "Farcaster", xiaohongshu: "Xiaohongshu", weibo: "Weibo", wechat: "WeChat", maimai: "Maimai",
  vk: "VK", line: "LINE", naver: "Naver Blog", xing: "Xing",
};

export const platformLabel = (key: string) => PLATFORM_LABELS[key] ?? key;
