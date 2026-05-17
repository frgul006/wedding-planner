#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { chromium } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const outputDir = resolve(
  process.cwd(),
  process.env.MOTION_REVIEW_OUTPUT_DIR ?? "artifacts/invite-motion-review",
);
const framesDir = resolve(outputDir, "frames");
const viewport = { height: 1080, width: 390 };
const defaultToken = "visual-updates-published";
const settleFrameCount = 8;
const settleFrameDelayMs = 55;

let failedScenarioCount = 0;
let frameIndex = 0;
const scenarios = [];

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function inviteUrl({ hash, reducedMotion = false, token = defaultToken }) {
  const url = new URL(`/invite/${token}`, baseURL);

  if (reducedMotion) {
    url.searchParams.set("motionReviewReduced", "1");
  }

  url.hash = hash;
  return url.toString();
}

async function hideDevOverlays(page) {
  await page.addStyleTag({
    content: `
      nextjs-portal,
      [data-nextjs-dev-tools-button],
      [data-nextjs-dev-tools-panel],
      [data-nextjs-dialog-overlay],
      [data-nextjs-toast] {
        display: none !important;
      }
    `,
  });
}

async function waitForInvite(page) {
  await page.waitForSelector('[data-testid="invite-panel-carousel"]', {
    timeout: 10_000,
  });
  await hideDevOverlays(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function gotoInvite(page, hash, options = {}) {
  await page.emulateMedia({
    colorScheme: "light",
    reducedMotion: options.reducedMotion ? "reduce" : "no-preference",
  });
  await page.goto(inviteUrl({ hash, reducedMotion: options.reducedMotion }));
  await waitForInvite(page);
  await delay(120);
}

async function capture(page, scenario, label) {
  frameIndex += 1;
  const fileName = `${String(frameIndex).padStart(3, "0")}-${slugify(scenario)}-${slugify(label)}.png`;
  await page.screenshot({ path: resolve(framesDir, fileName) });

  return { fileName, label };
}

async function captureSettle(page, scenario, label) {
  const frames = [];

  for (let index = 0; index < settleFrameCount; index += 1) {
    await delay(settleFrameDelayMs);
    frames.push(await capture(page, scenario, `${label} +${(index + 1) * settleFrameDelayMs}ms`));
  }

  return frames;
}

async function clickSelector(page, selector) {
  await page.evaluate((selectorToClick) => {
    const element = document.querySelector(selectorToClick);

    if (!(element instanceof HTMLElement)) {
      throw new Error(`Missing click target: ${selectorToClick}`);
    }

    element.click();
  }, selector);
}

async function startSyntheticTouch(page) {
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="invite-panel-carousel"]');
    const viewportElement = document.querySelector('[data-testid="invite-panel-viewport"]');

    if (!(root instanceof HTMLElement) || !(viewportElement instanceof HTMLElement)) {
      throw new Error("Invite carousel is not ready for synthetic touch.");
    }

    const rect = viewportElement.getBoundingClientRect();
    const yWithinViewport = Math.min(
      Math.max(rect.height * 0.36, 180),
      Math.max(rect.height - 48, 180),
    );
    const drag = {
      pointerId: Math.floor(performance.now()) + 200,
      root,
      x: rect.left + rect.width / 2,
      y: rect.top + yWithinViewport,
    };

    window.__inviteMotionReviewDrag = drag;

    const event = new PointerEvent("pointerdown", {
      bubbles: true,
      buttons: 1,
      cancelable: true,
      clientX: drag.x,
      clientY: drag.y,
      composed: true,
      isPrimary: true,
      pointerId: drag.pointerId,
      pointerType: "touch",
    });

    drag.root.dispatchEvent(event);
  });
}

async function moveSyntheticTouch(page, delta) {
  await page.evaluate((nextDelta) => {
    const drag = window.__inviteMotionReviewDrag;

    if (!drag) {
      throw new Error("Synthetic touch has not started.");
    }

    drag.root.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      buttons: 1,
      cancelable: true,
      clientX: drag.x + nextDelta,
      clientY: drag.y,
      composed: true,
      isPrimary: true,
      pointerId: drag.pointerId,
      pointerType: "touch",
    }));
  }, delta);
}

async function finishSyntheticTouch(page, delta, type = "pointerup") {
  await page.evaluate(({ delta: finalDelta, pointerEventType }) => {
    const drag = window.__inviteMotionReviewDrag;

    if (!drag) {
      throw new Error("Synthetic touch has not started.");
    }

    drag.root.dispatchEvent(new PointerEvent(pointerEventType, {
      bubbles: true,
      buttons: 0,
      cancelable: true,
      clientX: drag.x + finalDelta,
      clientY: drag.y,
      composed: true,
      isPrimary: true,
      pointerId: drag.pointerId,
      pointerType: "touch",
    }));

    delete window.__inviteMotionReviewDrag;
  }, { delta, pointerEventType: type });
}

async function captureDrag(page, scenario, delta, options = {}) {
  const frames = [];
  const steps = options.steps ?? 10;
  const stepDelayMs = options.stepDelayMs ?? 45;
  const holdMs = options.holdMs ?? 160;

  await startSyntheticTouch(page);

  for (let step = 1; step <= steps; step += 1) {
    const nextDelta = delta * (step / steps);
    await moveSyntheticTouch(page, nextDelta);
    await delay(stepDelayMs);
    frames.push(await capture(page, scenario, `drag ${Math.round(nextDelta)}px`));
  }

  await delay(holdMs);
  frames.push(await capture(page, scenario, `hold ${delta}px`));
  await finishSyntheticTouch(page, delta);
  frames.push(...await captureSettle(page, scenario, "release"));

  return frames;
}

async function runScenario(name, run) {
  console.log(`• ${name}`);

  try {
    const frames = await run();
    scenarios.push({ frames, name });
  } catch (error) {
    failedScenarioCount += 1;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  failed: ${message}`);
    scenarios.push({ error: message, frames: [], name });
  }
}

function renderIndex() {
  const sections = scenarios.map((scenario) => {
    const figures = scenario.frames.map((frame) => `
      <figure>
        <img src="frames/${frame.fileName}" alt="${frame.label}">
        <figcaption>${frame.label}</figcaption>
      </figure>
    `).join("");
    const failure = scenario.error
      ? `<p class="error">Scenario failed before a full frame set was captured: ${escapeHtml(scenario.error)}</p>`
      : "";

    return `
      <section>
        <h2>${scenario.name}</h2>
        ${failure}
        <div class="frames">${figures}</div>
      </section>
    `;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Invite motion review filmstrip</title>
  <style>
    body { margin: 0; background: #f5efe6; color: #31251d; font-family: ui-sans-serif, system-ui, sans-serif; }
    header, section { padding: 1rem; }
    header { border-bottom: 1px solid #d7c6b7; background: #fffaf1; position: sticky; top: 0; z-index: 1; }
    h1 { font-family: Georgia, serif; font-weight: 500; margin: 0 0 0.4rem; }
    h2 { font-size: 1rem; letter-spacing: 0.04em; text-transform: uppercase; }
    p { color: #7a6657; }
    .error { border-left: 4px solid #8a5a00; background: #fff6db; color: #5d3a00; padding: 0.75rem; }
    .frames { display: grid; gap: 0.8rem; grid-auto-flow: column; grid-auto-columns: minmax(220px, 390px); overflow-x: auto; padding-bottom: 0.8rem; }
    figure { margin: 0; border: 1px solid #d7c6b7; background: #fffaf1; padding: 0.5rem; }
    img { display: block; width: 100%; height: auto; }
    figcaption { color: #7a6657; font-size: 0.85rem; margin-top: 0.45rem; }
    code { background: #fffaf1; border: 1px solid #d7c6b7; padding: 0.1rem 0.25rem; }
  </style>
</head>
<body>
  <header>
    <h1>Invite motion review filmstrip</h1>
    <p>Generated from real app frames at <code>${baseURL}</code>. Not intended as CI baseline.</p>
  </header>
  ${sections}
</body>
</html>`;
}

async function main() {
  await mkdir(framesDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport,
  });

  try {
    await runScenario("Follow-finger drag + snap-back", async () => {
      await gotoInvite(page, "detaljer");
      return [
        await capture(page, "follow snapback", "start Detaljer"),
        ...await captureDrag(page, "follow snapback", -72, {
          holdMs: 500,
          stepDelayMs: 60,
          steps: 10,
        }),
      ];
    });

    await runScenario("Committed release", async () => {
      await gotoInvite(page, "inbjudan");
      return [
        await capture(page, "commit", "start Inbjudan"),
        ...await captureDrag(page, "commit", -154, {
          holdMs: 120,
          stepDelayMs: 45,
          steps: 10,
        }),
      ];
    });

    await runScenario("Edge resistance at both ends", async () => {
      await gotoInvite(page, "inbjudan");
      const firstEdge = [
        await capture(page, "edge first", "start Inbjudan"),
        ...await captureDrag(page, "edge first", 220, {
          holdMs: 420,
          stepDelayMs: 45,
          steps: 10,
        }),
      ];

      await gotoInvite(page, "osa");
      const lastEdge = [
        await capture(page, "edge last", "start OSA"),
        ...await captureDrag(page, "edge last", -220, {
          holdMs: 420,
          stepDelayMs: 45,
          steps: 10,
        }),
      ];

      return [...firstEdge, ...lastEdge];
    });

    await runScenario("Arrow navigation", async () => {
      await gotoInvite(page, "inbjudan");
      const frames = [await capture(page, "arrows", "start Inbjudan")];
      await clickSelector(page, 'button[aria-label="Nästa panel"]');
      frames.push(...await captureSettle(page, "arrows", "next arrow"));
      await clickSelector(page, 'button[aria-label="Nästa panel"]');
      frames.push(...await captureSettle(page, "arrows", "next arrow again"));
      await clickSelector(page, 'button[aria-label="Föregående panel"]');
      frames.push(...await captureSettle(page, "arrows", "previous arrow"));
      return frames;
    });

    await runScenario("Dot navigation", async () => {
      await gotoInvite(page, "inbjudan");
      const frames = [await capture(page, "dots", "start Inbjudan")];
      await clickSelector(page, 'a[aria-label="Gå till OSA"]');
      frames.push(...await captureSettle(page, "dots", "dot to OSA"));
      await clickSelector(page, 'a[aria-label="Gå till Detaljer"]');
      frames.push(...await captureSettle(page, "dots", "dot to Detaljer"));
      return frames;
    });

    await runScenario("Internal CTA/link navigation + height change", async () => {
      await gotoInvite(page, "inbjudan");
      const frames = [await capture(page, "links height", "start Inbjudan")];
      await clickSelector(page, 'a[href="#detaljer"]');
      frames.push(...await captureSettle(page, "links height", "cover CTA to Detaljer"));
      await clickSelector(page, 'a[href="#osa"]');
      frames.push(...await captureSettle(page, "links height", "Detaljer CTA to OSA"));
      return frames;
    });

    await runScenario("Reduced-motion confirmation", async () => {
      await gotoInvite(page, "inbjudan", { reducedMotion: true });
      const frames = [await capture(page, "reduced", "start reduced Inbjudan")];
      await clickSelector(page, 'a[href="#detaljer"]');
      await delay(55);
      frames.push(await capture(page, "reduced", "55ms after reduced CTA"));
      await delay(320);
      frames.push(await capture(page, "reduced", "settled reduced CTA"));
      return frames;
    });
  } finally {
    await browser.close();
  }

  await writeFile(resolve(outputDir, "index.html"), renderIndex());
  console.log(`\nFilmstrip written to ${resolve(outputDir, "index.html")}`);

  if (failedScenarioCount > 0) {
    process.exitCode = 1;
    console.error(`${failedScenarioCount} scenario(s) failed. Partial artifact was still written.`);
  }
}

main().catch((error) => {
  console.error(error);
  console.error("\nMake sure local Supabase is seeded (`pnpm seed:local`) and Next is running (`pnpm dev`).");
  process.exitCode = 1;
});
