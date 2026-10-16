import { afterEach, describe, expect, it, vi } from "vitest";
import { getPlatformMeta, PLATFORMS } from "./platforms";
import { copyAndOpenPlatform } from "./platform-handoff";

afterEach(() => vi.unstubAllGlobals());

describe("platform compose URLs", () => {
  const text = `Edited insight 👩🏽‍💻 — café & growth + 12%\n\nSource: Desk\nhttps://news.test/a?one=1&two=%23tag#section\n\n#Marketing #AI`;
  it.each([
    ["linkedin", "www.linkedin.com", "/feed/", "text"],
    ["twitter", "twitter.com", "/intent/tweet", "text"],
    ["threads", "www.threads.com", "/intent/post", "text"],
    ["bluesky", "bsky.app", "/intent/compose", "text"],
    ["farcaster", "warpcast.com", "/~/compose", "text"],
    ["weibo", "service.weibo.com", "/share/share.php", "title"],
    ["vk", "vk.com", "/share.php", "title"],
    ["line", "social-plugins.line.me", "/lineit/share", "text"],
  ])("preserves the full %s payload without duplicate links or silent truncation", (platform, host, pathname, parameter) => {
    const meta = getPlatformMeta(platform);
    for (const content of [text, `${"x".repeat(5000)}\n${text}`]) {
      const url = new URL(meta.composeUrl(content, "https://news.test/a?one=1&two=%23tag#section"));
      expect(url.hostname).toBe(host);
      expect(url.pathname).toBe(pathname);
      expect(url.searchParams.get(parameter)).toBe(content);
      expect(url.searchParams.has("url")).toBe(false);
    }
  });

  it("uses the text composer, not LinkedIn's article-only sharing dialog", () => {
    const url = new URL(getPlatformMeta("linkedin").composeUrl(text, "https://news.test/a"));
    expect(url.searchParams.get("shareActive")).toBe("true");
    expect(url.href).not.toContain("share-offsite");
    expect(url.searchParams.get("text")).toBe(text);
  });

  it("does not reinsert a link the user removed from the visible post", () => {
    expect(new URL(getPlatformMeta("linkedin").composeUrl("My edit", "https://news.test/a")).searchParams.get("text")).toBe("My edit");
  });

  it.each(PLATFORMS)("keeps $label on a fixed HTTPS destination", meta => {
    const url = new URL(meta.composeUrl('javascript:alert(1)\n<script>hello</script>', "javascript:alert(2)"));
    expect(url.protocol).toBe("https:");
    expect(url.username).toBe("");
    expect(url.password).toBe("");
  });
});

describe("clipboard-first handoff", () => {
  const destination = "https://www.linkedin.com/feed/?shareActive=true&text=post";
  function setup(write = () => Promise.resolve()) {
    const actions: string[] = [];
    const link = { href: "", target: "", rel: "", referrerPolicy: "", click: vi.fn(() => { actions.push("navigate"); }) };
    const popup = { opener: {} as object | null, closed: false,
      close: vi.fn((): void => { popup.closed = true; }),
      document: { createElement: vi.fn(() => link), body: { appendChild: vi.fn() } } };
    const writeText = vi.fn(() => { actions.push("copy"); return write(); });
    const open = vi.fn(() => { actions.push("reserve"); return popup; });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("window", { open });
    return { actions, link, popup, writeText, open };
  }

  it("reserves a navigation-capable popup before permission and uses its isolated no-referrer link", async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const { actions, link, popup, writeText, open } = setup(() => pending);
    const result = copyAndOpenPlatform("post", destination);
    expect(actions).toEqual(["copy", "reserve"]);
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(popup.opener).toBeNull();
    expect(link.click).not.toHaveBeenCalled();
    finish();
    expect(await result).toBe("opened");
    expect(writeText).toHaveBeenCalledWith("post");
    expect(popup.document.createElement).toHaveBeenCalledWith("a");
    expect(popup.document.body.appendChild).toHaveBeenCalledWith(link);
    expect(link).toMatchObject({ href: destination, target: "_self", rel: "noopener noreferrer", referrerPolicy: "no-referrer" });
    expect(actions).toEqual(["copy", "reserve", "navigate"]);
    expect(popup.close).not.toHaveBeenCalled();
  });

  it.each(["false", "throws"])("rejects ownership at admission (%s) without copying or reserving", async kind => {
    const { writeText, open } = setup();
    const guard = () => { if (kind === "throws") throw new Error("Owner gone"); return false; };
    expect(await copyAndOpenPlatform("post", destination, guard)).toBe("abandoned");
    expect(writeText).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it.each(["copied", "rejected", "guard throws"])("closes the reserved blank popup when ownership is lost during clipboard permission (%s)", async outcome => {
    let finish!: () => void, reject!: (error: Error) => void;
    const pending = new Promise<void>((resolve, fail) => { finish = resolve; reject = fail; });
    const { link, popup, writeText, open } = setup(() => pending);
    let owned = true;
    const guard = () => { if (!owned && outcome === "guard throws") throw new Error("Owner gone"); return owned; };
    const result = copyAndOpenPlatform("post", destination, guard);
    expect(open).toHaveBeenCalledOnce();
    owned = false;
    if (outcome === "rejected") reject(new Error("Clipboard denied")); else finish();
    expect(await result).toBe("abandoned");
    // A started/successful clipboard write cannot be rolled back. Only navigation is revoked.
    expect(writeText).toHaveBeenCalledExactlyOnceWith("post");
    expect(popup.close).toHaveBeenCalledOnce();
    expect(popup.closed).toBe(true);
    expect(link.click).not.toHaveBeenCalled();
  });

  it("checks ownership immediately before the external click, even after preparing the link", async () => {
    const { link, popup } = setup();
    let owned = true;
    popup.document.body.appendChild.mockImplementation(() => { owned = false; });
    expect(await copyAndOpenPlatform("post", destination, () => owned)).toBe("abandoned");
    expect(popup.document.body.appendChild).toHaveBeenCalledWith(link);
    expect(link.click).not.toHaveBeenCalled();
    expect(popup.close).toHaveBeenCalledOnce();
  });

  it("does not turn failed abandonment cleanup into a navigation or rejection", async () => {
    let finish!: () => void;
    const { link, popup } = setup(() => new Promise<void>(resolve => { finish = resolve; }));
    let owned = true;
    const result = copyAndOpenPlatform("post", destination, () => owned);
    popup.close.mockImplementation(() => { throw new Error("Tab unavailable"); });
    owned = false; finish();
    expect(await result).toBe("abandoned");
    expect(link.click).not.toHaveBeenCalled();
  });

  it("does not open a platform when clipboard access is missing or throws synchronously", async () => {
    const close = vi.fn();
    const navigate = vi.fn();
    const open = vi.fn(() => ({ opener: {}, close, location: { replace: navigate } }));
    vi.stubGlobal("window", { open });
    vi.stubGlobal("navigator", {});
    expect(await copyAndOpenPlatform("post", destination)).toBe("copy-failed");
    vi.stubGlobal("navigator", { clipboard: { writeText: () => { throw new Error("denied"); } } });
    expect(await copyAndOpenPlatform("post", destination)).toBe("copy-failed");
    expect(open.mock.calls).toEqual([["about:blank", "_blank"], ["about:blank", "_blank"]]);
    expect(close).toHaveBeenCalledTimes(2);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("retains successful copy if opening the tab throws", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("window", { open: () => { throw new Error("blocked"); } });
    expect(await copyAndOpenPlatform("post", destination)).toBe("open-failed");
    expect(writeText).toHaveBeenCalledWith("post");
  });
});