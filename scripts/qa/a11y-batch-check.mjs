// One-off measurement driver for the WCAG accessibility batch on branch
// claude/production-bugs-backlog-okvown. Measures, in the REAL built app, the
// Discover-filters age-range slider hit area (WCAG 2.5.5 — the only change whose
// claim is layout/visual and so needs a real measurement, not a bundle grep).
// The aria-describedby (Settings), heading-level, and required-semantics fixes
// are DOM-attribute changes verified by grepping the built bundle in the report.
// Run: node scripts/qa/a11y-batch-check.mjs (vite preview must serve :4173)
import { getPooledAccount, launch, login, check, finish } from "./harness.mjs";

const acct = await getPooledAccount(0);
const { browser, page, errors } = await launch({ hasTouch: true });
try {
  await login(page, acct);

  const filtersBtn = page.getByRole("button", { name: /^Filters$/ }).first();
  await filtersBtn.click();
  await page.waitForTimeout(700);

  const sliders = page.getByRole("slider");
  const n = await sliders.count();
  check("Discover filters expose 2 age-range sliders", n === 2, `count=${n}`);

  let worstMin = 999;
  for (let i = 0; i < n; i++) {
    const box = await sliders.nth(i).boundingBox();
    if (box) worstMin = Math.min(worstMin, Math.floor(box.width), Math.floor(box.height));
  }
  check("Age-slider thumb actionable area ≥44px (WCAG 2.5.5)", worstMin >= 44, `smallest=${worstMin}px`);

  // The visible knob must still be small (calm design) — assert the inner span
  // stays ~26px so the transparent 44px wrapper didn't inflate the visuals.
  const knobW = await page.evaluate(() => {
    const s = document.querySelector('[role="slider"] > span[aria-hidden="true"]');
    return s ? Math.round(s.getBoundingClientRect().width) : -1;
  });
  check("Visible knob stays small (~26px, calm)", knobW >= 24 && knobW <= 30, `knob=${knobW}px`);

  check("No console pageerrors during slider check", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
}
finish();
