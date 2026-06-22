import { test, expect, request as pwRequest } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * End-to-end QA sweep for the portfolio.
 *
 * Target URL: process.env.PORTFOLIO_URL if set, otherwise the local dev server
 * (config baseURL = http://localhost:8000). The site is not deployed yet, so the
 * local server is the default.
 *
 * NOTE ON CHECKS 6 & 7: this portfolio has NO contact section by design — no
 * social links and no mailto: link. Those checks therefore verify *correct
 * absence* rather than presence, which is the actual requirement for this page.
 *
 * Writes a markdown report to tests/qa-report.md and screenshots to
 * tests/screenshots/. Runs on chromium only (single, consistent report).
 */

const TARGET = process.env.PORTFOLIO_URL || '/';
const SHOTS_DIR = path.join('tests', 'screenshots');
const REPORT = path.join('tests', 'qa-report.md');

type Status = 'PASS' | 'FAIL' | 'WARN';
const results: { name: string; status: Status; detail: string }[] = [];
const record = (name: string, status: Status, detail = '') =>
  results.push({ name, status, detail });

test.describe('Portfolio QA sweep', () => {
  test('full QA sweep + report', async ({ page, browserName }, testInfo) => {
    // Single engine so the report/screenshots aren't written by 4 projects at once.
    test.skip(testInfo.project.name !== 'chromium', 'QA report runs on chromium only');
    test.setTimeout(120_000);
    fs.mkdirSync(SHOTS_DIR, { recursive: true });

    // 1) Open the portfolio
    let baseForRequests = 'http://localhost:8000';
    try {
      const resp = await page.goto(TARGET, { waitUntil: 'networkidle' });
      baseForRequests = new URL(page.url()).origin;
      record('1. Page loads', resp && resp.ok() ? 'PASS' : 'FAIL',
        `${page.url()} → HTTP ${resp ? resp.status() : 'no response'}`);
    } catch (e) {
      record('1. Page loads', 'FAIL', String(e));
    }

    // 2) Title + meta description
    try {
      const title = await page.title();
      const titleOk = title === 'Leo Nicholas Zotomayor | Portfolio';
      const desc = await page.locator('meta[name="description"]').getAttribute('content');
      const descOk = !!desc && desc.length > 0 && desc.length <= 160;
      record('2. Title correct', titleOk ? 'PASS' : 'FAIL', `title="${title}"`);
      record('2. Meta description set', descOk ? 'PASS' : 'FAIL',
        `len=${desc?.length ?? 0}/160 — "${desc ?? ''}"`);
    } catch (e) {
      record('2. Title / meta description', 'FAIL', String(e));
    }

    // 3) Profile photo loads
    try {
      const img = page.locator('.hero-photo img');
      await expect(img).toBeVisible();
      const loaded = await img.evaluate(
        (el: HTMLImageElement) => el.complete && el.naturalWidth > 0);
      record('3. Profile photo loads', loaded ? 'PASS' : 'FAIL',
        `naturalWidth ${await img.evaluate((el: HTMLImageElement) => el.naturalWidth)}px`);
    } catch (e) {
      record('3. Profile photo loads', 'FAIL', String(e));
    }

    // 4) Download Resume opens / downloads a PDF
    try {
      const cta = page.locator('.cta');
      const href = await cta.getAttribute('href');
      const resumeUrl = new URL(href || '', page.url()).toString();
      const ctx = await pwRequest.newContext();
      const head = await ctx.get(resumeUrl);
      const ct = (head.headers()['content-type'] || '').toLowerCase();
      const httpOk = head.status() === 200 && ct.includes('pdf');
      await ctx.dispose();

      // Also exercise the actual click (download attribute → browser download)
      let downloaded = '';
      try {
        const [dl] = await Promise.all([
          page.waitForEvent('download', { timeout: 4000 }),
          cta.click(),
        ]);
        downloaded = dl.suggestedFilename();
      } catch { /* may open in a new tab instead; HTTP check is authoritative */ }

      record('4. Resume is a real PDF', httpOk ? 'PASS' : 'FAIL',
        `${resumeUrl} → HTTP ${head.status()} (${ct || 'no content-type'})` +
        (downloaded ? `, downloaded as "${downloaded}"` : ''));
    } catch (e) {
      record('4. Resume is a real PDF', 'FAIL', String(e));
    }

    // 5) Every 'View live' link returns 200
    try {
      const hrefs = await page.locator('.view-live').evaluateAll(
        (as) => as.map((a) => (a as HTMLAnchorElement).href));
      const ctx = await pwRequest.newContext();
      const rows: string[] = [];
      let allOk = hrefs.length > 0;
      for (const h of hrefs) {
        try {
          const r = await ctx.get(h, { timeout: 15_000 });
          if (r.status() !== 200) allOk = false;
          rows.push(`${h} → ${r.status()}`);
        } catch (err) {
          allOk = false;
          rows.push(`${h} → ERROR (${String(err).slice(0, 60)})`);
        }
      }
      await ctx.dispose();
      record('5. "View live" links return 200', allOk ? 'PASS' : 'FAIL', rows.join('; '));
    } catch (e) {
      record('5. "View live" links return 200', 'FAIL', String(e));
    }

    // 6) Social links — EXPECTED ABSENT by design (no contact section)
    try {
      const social = await page.locator('a').evaluateAll((as) =>
        as.map((a) => (a as HTMLAnchorElement).href)
          .filter((h) => /linkedin|twitter|x\.com|instagram|facebook|bsky|mastodon|threads|github\.com/i.test(h)));
      record('6. Social links', social.length === 0 ? 'PASS' : 'FAIL',
        social.length === 0
          ? 'None present — correct (portfolio has no contact/social section by design)'
          : `Unexpected social links found: ${social.join(', ')}`);
    } catch (e) {
      record('6. Social links', 'FAIL', String(e));
    }

    // 7) mailto: link — EXPECTED ABSENT by design
    try {
      const mailtos = await page.locator('a[href^="mailto:"]').evaluateAll(
        (as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href') || ''));
      // If one ever exists, it must be well-formed.
      const malformed = mailtos.filter((m) => !/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+/.test(m));
      const ok = mailtos.length === 0 || malformed.length === 0;
      record('7. mailto: link', ok ? 'PASS' : 'FAIL',
        mailtos.length === 0
          ? 'None present — correct (no contact section by design)'
          : `Found: ${mailtos.join(', ')}${malformed.length ? ` — MALFORMED: ${malformed.join(', ')}` : ' — well-formed'}`);
    } catch (e) {
      record('7. mailto: link', 'FAIL', String(e));
    }

    // 8) Screenshots: desktop / tablet / mobile
    const viewports: { label: string; w: number; h: number; file: string }[] = [
      { label: 'Desktop', w: 1440, h: 900, file: 'qa-desktop-1440x900.png' },
      { label: 'Tablet', w: 768, h: 1024, file: 'qa-tablet-768x1024.png' },
      { label: 'Mobile', w: 375, h: 667, file: 'qa-mobile-375x667.png' },
    ];
    const shotPaths: Record<string, string> = {};
    for (const v of viewports) {
      try {
        await page.setViewportSize({ width: v.w, height: v.h });
        await page.goto(TARGET, { waitUntil: 'networkidle' });
        const out = path.join(SHOTS_DIR, v.file);
        await page.screenshot({ path: out, fullPage: true });
        shotPaths[v.label] = path.join('screenshots', v.file).replace(/\\/g, '/');
        record(`8. ${v.label} screenshot (${v.w}x${v.h})`, 'PASS', shotPaths[v.label]);
      } catch (e) {
        record(`8. ${v.label} screenshot (${v.w}x${v.h})`, 'FAIL', String(e));
      }
    }

    // 9) No horizontal scroll on mobile (375x667)
    try {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(TARGET, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        win: window.innerWidth,
      }));
      const ok = overflow.doc <= overflow.win + 1;
      record('9. No horizontal scroll (mobile)', ok ? 'PASS' : 'FAIL',
        `scrollWidth ${overflow.doc} vs innerWidth ${overflow.win}`);
    } catch (e) {
      record('9. No horizontal scroll (mobile)', 'FAIL', String(e));
    }

    // ----- write markdown report -----
    const passed = results.filter((r) => r.status === 'PASS').length;
    const failed = results.filter((r) => r.status === 'FAIL').length;
    const warned = results.filter((r) => r.status === 'WARN').length;
    const icon = (s: Status) => (s === 'PASS' ? '✅' : s === 'FAIL' ? '❌' : '⚠️');

    const lines: string[] = [];
    lines.push('# Portfolio QA Report');
    lines.push('');
    lines.push(`- **Target:** ${page.url()}`);
    lines.push(`- **Engine:** ${browserName}`);
    lines.push(`- **Summary:** ${passed} passed · ${failed} failed · ${warned} warnings (of ${results.length} checks)`);
    lines.push('');
    lines.push('| Check | Result | Detail |');
    lines.push('| --- | :---: | --- |');
    for (const r of results) {
      lines.push(`| ${r.name} | ${icon(r.status)} ${r.status} | ${r.detail.replace(/\|/g, '\\|')} |`);
    }
    lines.push('');
    lines.push('## Screenshots');
    for (const v of viewports) {
      if (shotPaths[v.label]) {
        lines.push(`### ${v.label} (${v.w}×${v.h})`);
        lines.push(`![${v.label}](${shotPaths[v.label]})`);
        lines.push('');
      }
    }
    lines.push('> Checks 6 & 7 verify correct **absence** — this portfolio intentionally has no contact section, social links, or mailto: link.');
    lines.push('');
    fs.writeFileSync(REPORT, lines.join('\n'), 'utf8');
    console.log(`QA report written to ${REPORT} (${passed}/${results.length} passed)`);

    // Surface red in CI if anything genuinely failed.
    expect(failed, `QA failures:\n${results.filter(r => r.status === 'FAIL').map(r => `- ${r.name}: ${r.detail}`).join('\n')}`).toBe(0);
  });
});
