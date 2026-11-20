import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "@playwright/test";

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

export interface AxeViolation { id: string; impact: string | null; help: string; targets: string[]; html: string[] }

/** WCAG 2.1 A/AA violations on the page (or within `scope`), via axe-core injected into the page. */
export async function axeViolations(page: Page, scope?: string): Promise<AxeViolation[]> {
  if (!await page.evaluate(() => "axe" in window)) await page.addScriptTag({ content: axeSource });
  return page.evaluate(async selector => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[]; html: string; failureSummary?: string }> }> }> } }).axe;
    const context = selector ? document.querySelector(selector) ?? document : document;
    // Page-level rules (title, lang) belong to index.html, not to component fixtures.
    const result = await axe.run(context, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"], reporter: "v1",
      rules: { "document-title": { enabled: false }, "html-has-lang": { enabled: false } } });
    return result.violations.map(violation => ({ id: violation.id, impact: violation.impact, help: violation.help, targets: violation.nodes.slice(0, 5).map(node => node.target.join(" ")), html: violation.nodes.slice(0, 5).map(node => `${node.html.slice(0, 160)} :: ${node.failureSummary ?? ""}`) }));
  }, scope ?? null);
}
