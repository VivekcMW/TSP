import { vi } from 'vitest';
import { Headers } from 'node-fetch';
import type { CrawlPage } from '../../server/services/crawlerFetch';

const boundaries = vi.hoisted(() => ({ crawl: vi.fn(), ai: vi.fn(), identity: vi.fn(), publisher: vi.fn(), email: vi.fn() }));
export { boundaries };
// Keep parsers, evidence validators, orchestration, quota, auth and repositories real.
vi.mock('../../server/services/crawlerFetch', async original => ({
  ...await original<typeof import('../../server/services/crawlerFetch')>(), fetchPublicText: boundaries.crawl,
}));
vi.mock('../../server/services/openRouter', async original => ({
  ...await original<typeof import('../../server/services/openRouter')>(),
  generateText: boundaries.identity, generateTextWithMetadata: boundaries.ai,
}));
vi.mock('../../server/services/publishers/mastodon', () => ({ publishToMastodon: boundaries.publisher }));
vi.mock('../../server/services/email', async original => ({
  ...await original<typeof import('../../server/services/email')>(), sendAppEmail: boundaries.email,
  sendVerificationEmail: boundaries.email, sendPasswordResetEmail: boundaries.email,
}));

export const prose = 'The pilot reduced latency by 12% in a trial of 30 stores. The engineering team measured response times during the controlled trial and reported the results.';
export function resetBoundaries(keyword: string, articleUrl: string) {
  for (const mock of Object.values(boundaries)) mock.mockReset();
  boundaries.email.mockResolvedValue({ skipped: true });
  boundaries.publisher.mockImplementation(() => { throw new Error('Unexpected live adapter dispatch'); });
  boundaries.crawl.mockImplementation(async (url: string): Promise<CrawlPage> => ({
    url, status: 200, headers: new Headers({ 'content-type': url.includes('/rss/') ? 'application/rss+xml' : 'text/html' }),
    text: url.includes('/rss/')
      ? `<rss version="2.0"><channel><title>Workflow</title><item><title>${keyword} pilot result</title><link>${articleUrl}</link><description>${prose}</description><source url="https://research.test">Research</source></item></channel></rss>`
      : `<html><head><title>${keyword} pilot result</title></head><body><article><p>${prose}</p></article></body></html>`,
  }));
  boundaries.ai.mockImplementation(async (prompt: string) => {
    const input = JSON.parse(prompt);
    const article = input.article;
    const content = `${article.source} reports 12% lower latency in a 30-store trial.` + (article.articleUrl ? ' ' + article.articleUrl : '');
    return { text: JSON.stringify({ content, attributions: [{ text: content, excerptIds: ['p1'] }] }),
      provider: 'openrouter', model: 'workflow-boundary', usage: { inputTokens: 10, outputTokens: 20 }, fallbackUsed: false };
  });
  boundaries.identity.mockImplementation(async (prompt: string) => {
    // Both original onboarding AI calls still execute and validate their own output.
    if (prompt.includes('recommendedIndustry')) return JSON.stringify({ recommendedIndustry: 'technology_saas', confidence: 0.9, reasoning: 'Engineering focus', matchedSignals: [keyword], dropdownAligned: true });
    return JSON.stringify({ primaryIndustry: 'technology_saas', confidence: 0.9, subDomains: ['Engineering'],
      keywords: [{ keyword, weight: 1 }], publications: [], topics: [], personalities: [], companies: [] });
  });
}