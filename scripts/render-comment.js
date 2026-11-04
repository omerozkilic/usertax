// Renders a usertax comment (Markdown, as posted on a pull request) to a PNG the way GitHub
// displays it: GitHub Flavored Markdown with GitHub's own stylesheet (github-markdown-css, MIT),
// in a comment frame. Used for the images in the README, the Marketplace page and the npm page;
// the input is real usertax output such as docs/demo/add-moment.md.
//
// Usage: node scripts/render-comment.js docs/demo/add-moment.md docs/assets/comment-add-moment.png
//        [--theme light|dark]   (needs Playwright with Chromium)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { micromark } from 'micromark';
import { gfm, gfmHtml } from 'micromark-extension-gfm';

const [input, output] = process.argv.slice(2);
if (input === undefined || output === undefined) {
  process.stderr.write('usage: render-comment.js <comment.md> <image.png> [--theme light|dark]\n');
  process.exit(2);
}
const themeIndex = process.argv.indexOf('--theme');
const theme = themeIndex === -1 ? 'light' : process.argv[themeIndex + 1];
const require = createRequire(import.meta.url);
const css = readFileSync(
  require.resolve(`github-markdown-css/github-markdown-${theme === 'dark' ? 'dark' : 'light'}.css`),
  'utf8',
);
// The comment is usertax's own output, so its HTML (<sub>, <details>) is rendered as GitHub does.
const body = micromark(readFileSync(input, 'utf8'), {
  allowDangerousHtml: true,
  extensions: [gfm()],
  htmlExtensions: [gfmHtml()],
});
const dark = theme === 'dark';
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}
  body { margin: 0; padding: 24px; background: ${dark ? '#0d1117' : '#ffffff'}; }
  .comment { width: 860px; border: 1px solid ${dark ? '#30363d' : '#d1d9e0'}; border-radius: 6px; overflow: hidden; }
  .header { padding: 8px 16px; font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
    color: ${dark ? '#9198a1' : '#59636e'}; background: ${dark ? '#151b23' : '#f6f8fa'}; border-bottom: 1px solid ${dark ? '#30363d' : '#d1d9e0'}; }
  .header b { color: ${dark ? '#f0f6fc' : '#1f2328'}; }
  .markdown-body { padding: 16px; }
</style></head><body><div class="comment"><div class="header"><b>github-actions</b> bot commented</div>
<article class="markdown-body">${body}</article></div></body></html>`;

// Playwright is not a dependency of this repository; it is resolved like a CommonJS module, so a
// global installation (NODE_PATH) works too.
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 920, height: 800 } });
await page.setContent(html, { waitUntil: 'load' });
await page.locator('.comment').screenshot({ path: output });
await browser.close();
process.stdout.write(`rendered ${input} to ${output}\n`);
