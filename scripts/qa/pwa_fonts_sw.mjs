// PWA / self-hosted-fonts / service-worker regression driver.
// Covers PROD-2 (no Google Fonts requests + Atkinson resolves), PROD-3
// (notificationclick navigates), PROD-5 (offline.html reachable + SW registers
// + navigation-only network-first, no hashed-asset caching).
//
// Run from repo root:  node scripts/qa/pwa_fonts_sw.mjs
import { readFileSync } from "node:fs";
import { launch, check, finish, APP } from "./harness.mjs";

const swSrc = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const offlineSrc = readFileSync(new URL("../../public/offline.html", import.meta.url), "utf8");
const indexSrc = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

// ── Static source assertions (behavioral bits that can't run in-harness) ──────
// PROD-3: focus-existing-window branch must navigate.
check("PROD-3 sw.js calls client.navigate(urlToOpen)", /client\.navigate\(urlToOpen\)/.test(swSrc));
check("PROD-3 sw.js guards navigate with 'navigate' in client", /'navigate' in client/.test(swSrc));
check("PROD-3 sw.js still focuses existing client", /client\.focus\(\)/.test(swSrc));
check("PROD-3 sw.js keeps openWindow fallback", /clients\.openWindow\(urlToOpen\)/.test(swSrc));

// PROD-5: navigation-only network-first, offline fallback, no hashed-asset cache.
check("PROD-5 sw.js precaches offline.html on install", /addAll\(\[OFFLINE_URL\]\)/.test(swSrc) || /addAll\(\['\/offline\.html'\]\)/.test(swSrc));
check("PROD-5 sw.js fetch handler is navigation-only", /request\.mode !== 'navigate'/.test(swSrc));
check("PROD-5 sw.js serves offline.html on navigation failure", /caches\.match\(OFFLINE_URL\)/.test(swSrc) || /caches\.match\('\/offline\.html'\)/.test(swSrc));
check("PROD-5 sw.js does NOT cache-first /assets", !/caches\.match\([^)]*assets/i.test(swSrc));
check("PROD-5 sw.js skipWaiting + clients.claim", /skipWaiting\(\)/.test(swSrc) && /clients\.claim\(\)/.test(swSrc));
check("PROD-5 offline.html has no external URL references", !/https?:\/\//.test(offlineSrc.replace(/lang="en"/g, "")));

// PROD-2: no Google Fonts links remain in index.html; self-hosted @font-face present.
check("PROD-2 index.html has NO fonts.googleapis link", !/fonts\.googleapis\.com/.test(indexSrc));
check("PROD-2 index.html has NO fonts.gstatic link", !/fonts\.gstatic\.com/.test(indexSrc));
check("PROD-2 index.html has self-hosted Atkinson @font-face", /@font-face[\s\S]*Atkinson Hyperlegible[\s\S]*\/fonts\/atkinson/.test(indexSrc));
check("PROD-2 index.html has self-hosted Newsreader @font-face", /@font-face[\s\S]*Newsreader[\s\S]*\/fonts\/newsreader/.test(indexSrc));

// ── Live-page assertions against the local preview build ──────────────────────
const { browser, page, errors } = await launch();
const googleFontReqs = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("fonts.googleapis.com") || u.includes("fonts.gstatic.com")) googleFontReqs.push(u);
});

await page.goto(APP, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

// PROD-2 runtime: zero requests to Google Fonts hosts.
check("PROD-2 ZERO requests to Google Fonts hosts", googleFontReqs.length === 0, `${googleFontReqs.length} req(s)`);

// PROD-2 runtime: computed font-family on body still resolves to Atkinson.
const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
check("PROD-2 body font-family starts with Atkinson Hyperlegible", /^["']?Atkinson Hyperlegible/.test(bodyFont), bodyFont);

// PROD-2 runtime: the Atkinson face actually loaded (document.fonts).
const atkinsonLoaded = await page.evaluate(async () => {
  try { await document.fonts.ready; } catch { /* noop */ }
  return document.fonts.check("16px 'Atkinson Hyperlegible'");
});
check("PROD-2 Atkinson Hyperlegible face is available", atkinsonLoaded);

// PROD-5 runtime: /offline.html reachable and is the calm page.
const offlineResp = await page.goto(APP + "/offline.html", { waitUntil: "domcontentloaded" });
check("PROD-5 /offline.html returns 200", offlineResp && offlineResp.status() === 200, String(offlineResp && offlineResp.status()));
const offlineH1 = await page.evaluate(() => (document.querySelector("h1") || {}).textContent || "");
check("PROD-5 /offline.html shows the calm heading", /offline/i.test(offlineH1), offlineH1);

// PROD-2 runtime: a self-hosted font file is served with 200 (Node fetch — a
// woff2 triggers a browser download, not a navigation, so page.goto can't be
// used here; the preview server is local so Node reaches it directly).
const fontResp = await fetch(APP + "/fonts/atkinson-400-latin.woff2");
check("PROD-2 /fonts/atkinson-400-latin.woff2 returns 200", fontResp.status === 200, `${fontResp.status} ${fontResp.headers.get("content-type")}`);

check("no console pageerrors", errors.length === 0, errors.join(" | "));

await browser.close();
finish();
