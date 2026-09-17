/**
 * Storefront integrity sweep: every representative page, both viewports, all
 * three languages. This does not re-test features — the numbered specs do
 * that — it checks the things that break quietly across a matrix: script
 * errors, horizontal overflow, broken images, lost direction, clipped
 * controls and unreachable primary actions.
 */
import assert from "node:assert/strict";

const LOCALES = ["ar", "he", "en"];
const DIR = { ar: "rtl", he: "rtl", en: "ltr" };
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const NARROW = { width: 320, height: 720 };

const PAGES = [
  ["home", ""],
  ["shop", "/shop"],
  ["category", "/category/retro"],
  ["product", "/product/crimson-2005"],
  ["search", "/search?q=crimson"],
  ["wishlist", "/wishlist"],
  ["cart", "/cart"],
  ["checkout", "/checkout"],
  ["track", "/track"],
  ["size-guide", "/size-guide"],
  ["about", "/about"],
  ["how-it-works", "/how-it-works"],
  ["delivery", "/delivery"],
  ["faq", "/faq"],
  ["reviews", "/reviews"],
  ["contact", "/contact"],
  ["returns", "/policies/returns"],
  ["privacy", "/policies/privacy"],
  ["terms", "/policies/terms"],
  ["accessibility", "/accessibility"],
  ["login", "/login"],
  ["register", "/register"],
  ["forgot-password", "/forgot-password"],
];

async function sweep({ newPage, BASE, viewport, label }) {
  const { page, context, pageErrors } = await newPage(viewport, viewport.width < 720 ? { hasTouch: true, isMobile: true } : {});
  const problems = [];
  try {
    for (const locale of LOCALES) {
      for (const [name, path] of PAGES) {
        await page.goto(`${BASE}/${locale}${path}`, { waitUntil: "networkidle" });

        const dir = await page.evaluate(() => document.documentElement.dir);
        if (dir !== DIR[locale]) problems.push(`${label}/${locale}/${name}: dir=${dir}, expected ${DIR[locale]}`);

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 2) problems.push(`${label}/${locale}/${name}: horizontal overflow ${overflow}px`);

        const broken = await page.evaluate(() => [...document.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute("src")));
        if (broken.length) problems.push(`${label}/${locale}/${name}: broken images ${broken.join(", ")}`);

        const main = await page.locator("main").count();
        if (main !== 1) problems.push(`${label}/${locale}/${name}: expected one <main>, found ${main}`);

        const text = (await page.locator("main").innerText()).trim();
        if (text.length < 20) problems.push(`${label}/${locale}/${name}: main is essentially empty`);
      }
    }
    if (pageErrors.length) problems.push(`${label}: page errors — ${pageErrors.join(" | ")}`);
  } finally {
    await context.close();
  }
  return problems;
}

export async function desktop_sweep_is_clean_in_all_three_languages({ newPage, BASE }) {
  const problems = await sweep({ newPage, BASE, viewport: DESKTOP, label: "desktop" });
  assert.deepEqual(problems, [], `desktop problems:\n${problems.join("\n")}`);
}

export async function mobile_sweep_is_clean_in_all_three_languages({ newPage, BASE }) {
  const problems = await sweep({ newPage, BASE, viewport: PHONE, label: "mobile" });
  assert.deepEqual(problems, [], `mobile problems:\n${problems.join("\n")}`);
}

export async function nothing_overflows_at_the_narrowest_supported_width({ newPage, BASE }) {
  const { page, context } = await newPage(NARROW, { hasTouch: true, isMobile: true });
  const problems = [];
  try {
    for (const locale of LOCALES) {
      for (const path of ["", "/shop", "/product/crimson-2005", "/cart", "/checkout"]) {
        await page.goto(`${BASE}/${locale}${path}`, { waitUntil: "networkidle" });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 2) problems.push(`320px/${locale}${path}: overflow ${overflow}px`);
      }
    }
  } finally {
    await context.close();
  }
  assert.deepEqual(problems, [], problems.join("\n"));
}

export async function the_primary_action_is_reachable_on_every_key_page({ newPage, BASE }) {
  const { page, context } = await newPage(PHONE, { hasTouch: true, isMobile: true });
  const problems = [];
  try {
    for (const locale of LOCALES) {
      // Product: add to cart must be present and inside the viewport once scrolled to.
      await page.goto(`${BASE}/${locale}/product/crimson-2005`, { waitUntil: "networkidle" });
      const cta = page.locator('button[type="submit"], .btn--gold').first();
      if ((await cta.count()) === 0) {
        problems.push(`${locale}/product: no primary action found`);
      } else {
        await cta.scrollIntoViewIfNeeded();
        const box = await cta.boundingBox();
        if (!box || box.width < 40 || box.height < 30) problems.push(`${locale}/product: primary action is too small (${JSON.stringify(box)})`);
        if (box && (box.x < -1 || box.x + box.width > PHONE.width + 1)) problems.push(`${locale}/product: primary action is clipped horizontally`);
      }

      // Language switch must exist and be operable on mobile.
      await page.goto(`${BASE}/${locale}`, { waitUntil: "networkidle" });
      const langLinks = await page.locator('a[href^="/ar"], a[href^="/he"], a[href^="/en"]').count();
      if (langLinks === 0) problems.push(`${locale}/home: no language links reachable`);
    }
  } finally {
    await context.close();
  }
  assert.deepEqual(problems, [], problems.join("\n"));
}
