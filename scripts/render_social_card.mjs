// Renders the Semantique social-share card (static/social-card.png).
//
// The card is the in-app wordmark — the same "semantique" you see in the HUD
// (.sq-title): Caveat 700 in ink-soft, tilted -2deg, on paper with the faint
// ruled-notebook lines (.sq-root::before). It is the og:image referenced by the
// `thumbnail:` field in README.md's HF Space frontmatter.
//
// Run (point PLAYWRIGHT_DIR at any node_modules that has playwright; npx caches
// one under ~/.npm/_npx/*, or `npx playwright install chromium` and drop the env):
//   PLAYWRIGHT_DIR=/path/to/node_modules node scripts/render_social_card.mjs
//
// Output is 2400x1260 (a 1200x630 OG card at deviceScaleFactor 2) so it stays
// crisp when chat apps and HF downscale it.
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const pwSpecifier = process.env.PLAYWRIGHT_DIR
  ? pathToFileURL(path.join(process.env.PLAYWRIGHT_DIR, "playwright", "index.js")).href
  : "playwright";
const pw = await import(pwSpecifier);
const chromium = pw.chromium ?? pw.default?.chromium;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "static", "social-card.png");

// Paper & ink, lifted straight from static/style.css.
const PAPER = "#faf8f2";
const INK_SOFT = "#5a564c";

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@700&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; }
  .card {
    width: 1200px; height: 630px;
    display: flex; align-items: center; justify-content: center;
    background: ${PAPER};
    overflow: hidden;
  }
  /* faint ruled-notebook lines, same hue as .sq-root::before, scaled up for the card */
  .card::before {
    content: ""; position: absolute; inset: 0;
    background: repeating-linear-gradient(
      to bottom,
      transparent 0 55px,
      rgba(110, 140, 170, 0.16) 55px 57px
    );
  }
  .word {
    position: relative;
    font-family: "Caveat", cursive;
    font-weight: 700;
    font-size: 232px;
    line-height: 1;
    color: ${INK_SOFT};
    transform: rotate(-2deg);
  }
</style></head>
<body><div class="card"><div class="word">semantique</div></div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});
await page.setContent(HTML, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.load('700 232px "Caveat"'));
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.locator(".card").screenshot({ path: OUT });
await browser.close();
console.log("wrote", OUT);
