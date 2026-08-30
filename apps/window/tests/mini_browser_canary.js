import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE_URL = (process.env.FRANK_BROWSER_URL || "http://127.0.0.1:8765/mini-frank/").replace(/\/$/, "");
const PORT = Number(process.env.FRANK_BROWSER_PORT || 9333);
const CHROME = process.env.CHROME_BIN || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PROFILE = path.join(os.tmpdir(), `frank-mini-browser-${process.pid}`);
const WINDOW_SIZE = process.argv[2] || "1440,900";
const SCREENSHOT = process.argv[3] || "";
const EXERCISE_SUBMIT = process.env.FRANK_BROWSER_EXERCISE_SUBMIT === "1";
// Keep the ordinary visual canary fast. Release checks can supply the real
// customer wording here and repeat it against fresh browser drafts without
// ever submitting a project for a full build.
const META_REGRESSION_PROMPT = "make me an meta ad generator";
const CUSTOMER_PROMPT = process.env.FRANK_BROWSER_TEST_PROMPT || META_REGRESSION_PROMPT;
const IS_META_REGRESSION = CUSTOMER_PROMPT.trim().toLowerCase() === META_REGRESSION_PROMPT;
const CONSECUTIVE_RUNS = Number(process.env.FRANK_BROWSER_CONSECUTIVE_RUNS || 1);
// A real guide reply currently takes about 32 seconds in production. Keep the
// optional end-to-end check useful without making the normal visual canary wait.
const RESPONSE_BUDGET_MS = Number(process.env.FRANK_BROWSER_RESPONSE_BUDGET_MS || 45000);
const COMPOSER_READY_BUDGET_MS = Number(process.env.FRANK_BROWSER_COMPOSER_READY_BUDGET_MS || 10000);
const REQUIRE_GUIDED_FLOW = process.env.FRANK_BROWSER_REQUIRE_GUIDED_FLOW !== "0";
const MAX_GUIDE_STEPS = Number(process.env.FRANK_BROWSER_MAX_GUIDE_STEPS || 6);
const [WIDTH, HEIGHT] = WINDOW_SIZE.split(",").map(Number);

if (!Number.isInteger(CONSECUTIVE_RUNS) || CONSECUTIVE_RUNS < 1 || CONSECUTIVE_RUNS > 10) {
  throw new Error("FRANK_BROWSER_CONSECUTIVE_RUNS must be a whole number from 1 to 10");
}
if (CONSECUTIVE_RUNS > 1 && !EXERCISE_SUBMIT) {
  throw new Error("FRANK_BROWSER_CONSECUTIVE_RUNS requires FRANK_BROWSER_EXERCISE_SUBMIT=1");
}
if (!Number.isInteger(MAX_GUIDE_STEPS) || MAX_GUIDE_STEPS < 1 || MAX_GUIDE_STEPS > 10) {
  throw new Error("FRANK_BROWSER_MAX_GUIDE_STEPS must be a whole number from 1 to 10");
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function guideReplyViolations(reply) {
  const value = String(reply || "").trim();
  const rules = [
    ["internal term", /\b(?:hermes|mini frank|blockwise|workspace|skills?|pipeline|system prompt|api|stack|architecture|agent|tokens?|run id|repo(?:sitory)?|terminal|sandbox|docker|javascript|html|css|runtime|framework|tool call|canonical path)\b/i],
    ["process narration", /\b(?:let me (?:check|inspect|probe|read|search|see|look)|i(?:'ll| will) (?:check|inspect|probe|read|search|see|look)|before i (?:build|make)|don['’]t want (?:to )?(?:build|make) the wrong|there(?:'s| is) a (?:real )?fork|which one|option [ab])\b/i],
    ["technical fork", /\b(?:standalone|offline|existing editor|existing ad maker|spreadsheet|cli|code)\b.*\b(?:or|versus)\b|\b(?:or|versus)\b.*\b(?:standalone|offline|existing editor|existing ad maker|spreadsheet|cli|code)\b/i],
  ];
  return rules.filter(([, pattern]) => pattern.test(value)).map(([label]) => label);
}

const COMPOSER_READY_EXPRESSION = `(() => {
  const composer = document.querySelector("#composer");
  const input = document.querySelector("#message");
  const send = composer?.querySelector('[data-action="send-message"]');
  return Boolean(composer && input && !input.disabled && send);
})()`;

async function waitForEvaluation(browser, expression, deadline, intervalMs = 150) {
  while (Date.now() < deadline) {
    if (await browser.evaluate(expression)) return true;
    await wait(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
  return Boolean(await browser.evaluate(expression));
}

async function waitForDevTools() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error("Chrome DevTools did not start");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        return new Promise((resolveResult, rejectResult) => {
          const id = nextId++;
          pending.set(id, { resolve: resolveResult, reject: rejectResult });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      evaluate(expression) { return this.send("Runtime.evaluate", { expression, returnByValue: true }).then((result) => result.result?.value); },
      close() { socket.close(); },
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    });
    socket.addEventListener("error", reject);
  });
}

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, `--window-size=${WINDOW_SIZE}`, "about:blank",
  ], { stdio: "ignore" });
  let browser;
  try {
    await waitForDevTools();
    const page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE_URL)}`, { method: "PUT" })).json();
    browser = await connect(page.webSocketDebuggerUrl);
    await browser.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: WIDTH < 768 });
    await wait(800);
    // The page shell can paint before the app module has attached its composer
    // behaviour. Wait for that initialisation in every mode so the shared
    // snapshot does not turn normal visual checks into a boot-time race. An
    // empty composer is correctly disabled, so readiness is the action binding,
    // not the button's enabled state.
    const composerReady = await waitForEvaluation(browser, COMPOSER_READY_EXPRESSION, Date.now() + COMPOSER_READY_BUDGET_MS);
    if (!composerReady) throw new Error("Composer did not become ready");

    const result = await browser.evaluate(`(() => {
      const rect = (selector) => {
        const item = document.querySelector(selector)?.getBoundingClientRect();
        return item ? { left: item.left, right: item.right, width: item.width, top: item.top, bottom: item.bottom } : null;
      };
      const input = document.querySelector("#message");
      const publicResources = [...document.querySelectorAll("link[href], script[src]")]
        .map((item) => item.href || item.src)
        .filter(Boolean);
      const loadedResources = performance.getEntriesByType("resource").map((item) => item.name);
      input.value = "A quick test";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const sendEnabled = !document.querySelector(".send-button")?.disabled;
      const sendAction = document.querySelector(".send-button")?.dataset.action || "";
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return {
        viewport: { width: innerWidth, height: innerHeight },
        canonicalPath: location.pathname,
        publicResources,
        hasLegacyPublicPath: [...publicResources, ...loadedResources].some((value) => {
          try {
            const resourcePath = new URL(value, location.origin).pathname;
            return resourcePath === "/frank" || resourcePath.startsWith("/frank/") || resourcePath === "/mini" || resourcePath.startsWith("/mini/");
          }
          catch { return false; }
        }),
        bodyWidth: document.body.getBoundingClientRect().width,
        scrollWidth: document.documentElement.scrollWidth,
        welcome: rect(".welcome"),
        heading: rect(".welcome h1"),
        composer: rect(".composer"),
        sendEnabled,
        sendAction,
        hasLegacyCopy: /building more projects is a paid feature|private link access|how private access works|before i build/i.test(document.body.innerText),
      };
    })()`);
    if (EXERCISE_SUBMIT) {
      const guideRuns = [];
      for (let run = 1; run <= CONSECUTIVE_RUNS; run += 1) {
        if (run > 1) {
          // A completed guide leaves a local draft intentionally. Clear only
          // this browser's local state before reloading so each canary pass
          // begins as a new customer conversation. The server never receives
          // the project's "solve" action in this test.
          await browser.evaluate(`(() => { localStorage.clear(); location.reload(); return true; })()`);
          const ready = await waitForEvaluation(browser, COMPOSER_READY_EXPRESSION, Date.now() + COMPOSER_READY_BUDGET_MS);
          if (!ready) throw new Error(`Composer did not become ready for guide run ${run}`);
        }

        const responseStarted = Date.now();
        const checkpoints = {
          requestStarted: true,
          accepted: false,
          complete: false,
          acceptedMs: null,
          completeMs: null,
        };
        const submissionStarted = await browser.evaluate(`(() => {
          const composer = document.querySelector("#composer");
          const input = document.querySelector("#message");
          const send = composer?.querySelector('[data-action="send-message"]');
          if (!composer || !input || input.disabled || !send || send.dataset.action !== "send-message") return false;
          input.value = ${JSON.stringify(CUSTOMER_PROMPT)};
          input.dispatchEvent(new Event("input", { bubbles: true }));
          if (send.disabled || send.dataset.action !== "send-message") return false;
          composer.requestSubmit();
          return true;
        })()`);
        if (!submissionStarted) throw new Error(`Composer was no longer ready when guide run ${run} began`);

        // Each Hermes turn gets the same bounded response window. The complete
        // guide intentionally spans several turns, so one wall-clock deadline
        // for the whole conversation would fail healthy production runs.
        let turnDeadline = responseStarted + RESPONSE_BUDGET_MS;
        checkpoints.accepted = await waitForEvaluation(browser, `(() => {
          const userMessage = document.querySelector(".message-user .message-text");
          const conversation = document.querySelector("#conversation");
          const latest = [...document.querySelectorAll(".message-assistant")].at(-1);
          const completed = latest?.querySelector('.guide-decision-card, [data-action="resume"]');
          return Boolean(userMessage && (
            conversation?.getAttribute("aria-busy") === "true" || completed
          ));
        })()`, turnDeadline);
        if (checkpoints.accepted) checkpoints.acceptedMs = Date.now() - responseStarted;

        const guideSteps = [];
        const guideReplies = [];
        let reachedConfirmation = false;
        for (let step = 1; checkpoints.accepted && step <= MAX_GUIDE_STEPS; step += 1) {
          turnDeadline = Date.now() + RESPONSE_BUDGET_MS;
          const settled = await waitForEvaluation(browser, `(() => {
            const latest = [...document.querySelectorAll(".message-assistant")].at(-1);
            if (!latest || latest.querySelector(".thinking")) return false;
            return Boolean(latest.querySelector('.guide-decision-card, [data-action="resume"]'));
          })()`, turnDeadline);
          if (!settled) break;

          const snapshot = await browser.evaluate(`(() => {
            const assistants = [...document.querySelectorAll(".message-assistant")];
            const latest = assistants.at(-1);
            const card = latest?.querySelector(".guide-decision-card");
            const message = latest?.querySelector(".message-text");
            const bounds = message?.getBoundingClientRect();
            const style = message ? getComputedStyle(message) : null;
            const understanding = card ? [...card.querySelectorAll(".guide-understanding [data-guide-fact]")].map((item) => item.textContent.trim()) : [];
            const optionButtons = card ? [...card.querySelectorAll("[data-guide-choice]")] : [];
            const previews = card ? [...card.querySelectorAll(".guide-mini-preview")].map((item) => ({
              kind: [...item.classList].find((name) => name.startsWith("guide-mini-preview-") && name !== "guide-mini-preview")?.replace("guide-mini-preview-", "") || "",
              text: item.textContent.replace(/\s+/g, " ").trim(),
            })) : [];
            return {
              assistantCount: assistants.length,
              response: message?.textContent?.trim() || "",
              responseVisible: Boolean(message && bounds && bounds.width > 0 && bounds.height > 0 && style?.visibility !== "hidden" && style?.display !== "none"),
              cardId: card?.dataset.guideCardId || "",
              kind: card?.dataset.guideKind || (latest?.querySelector('[data-action="resume"]') ? "confirm" : ""),
              question: card?.querySelector(".guide-decision-question")?.textContent?.trim() || "",
              options: optionButtons.map((item) => item.textContent.trim()),
              previewCount: card?.querySelectorAll(".guide-mini-preview").length || 0,
              previews,
              understanding,
              chooseForMe: Boolean(card?.querySelector('[data-action="guide-choose-for-me"]')),
              other: Boolean(card?.querySelector('[data-action="guide-other"]')),
              resumeAction: Boolean(latest?.querySelector('[data-action="resume"]')),
            };
          })()`);
          guideReplies.push(snapshot.response);
          guideSteps.push({
            step,
            kind: snapshot.kind,
            cardId: snapshot.cardId,
            question: snapshot.question,
            options: snapshot.options,
            previewCount: snapshot.previewCount,
            previews: snapshot.previews,
            understanding: snapshot.understanding,
            chooseForMe: snapshot.chooseForMe,
            other: snapshot.other,
            responseVisible: snapshot.responseVisible,
          });

          if (snapshot.resumeAction) {
            reachedConfirmation = true;
            break;
          }
          if (!["question", "preview"].includes(snapshot.kind) || snapshot.options.length < 2 || !snapshot.chooseForMe || !snapshot.other) break;

          const advanced = await browser.evaluate(`(() => {
            const latest = [...document.querySelectorAll(".message-assistant")].at(-1);
            const card = latest?.querySelector(".guide-decision-card");
            if (!card || card.dataset.guideCardId !== ${JSON.stringify(snapshot.cardId)}) return false;
            const choices = [...card.querySelectorAll("[data-guide-choice]:not(:disabled)")];
            const choice = choices.find((item) => item.dataset.recommended === "true") || choices[0];
            if (!choice) return false;
            choice.click();
            return true;
          })()`);
          if (!advanced) break;
          turnDeadline = Date.now() + RESPONSE_BUDGET_MS;
          const moved = await waitForEvaluation(browser, `(() => {
            const assistants = [...document.querySelectorAll(".message-assistant")];
            const latest = assistants.at(-1);
            if (assistants.length <= ${snapshot.assistantCount} || !latest || latest.querySelector(".thinking")) return false;
            return Boolean(latest.querySelector('.guide-decision-card, [data-action="resume"]'));
          })()`, turnDeadline);
          if (!moved) break;
        }

        checkpoints.complete = reachedConfirmation;
        if (checkpoints.complete) checkpoints.completeMs = Date.now() - responseStarted;
        const conversation = await browser.evaluate(`(() => {
          const message = [...document.querySelectorAll(".message-assistant .message-text")].at(-1);
          const bounds = message?.getBoundingClientRect();
          const style = message ? getComputedStyle(message) : null;
          return {
            statusCard: Boolean(document.querySelector(".status-card")),
            submittedJob: performance.getEntriesByType("resource").some(({ name }) => {
              try {
                const resourcePath = new URL(name, location.origin).pathname;
                return (
                  resourcePath.startsWith("/api/mini/intakes/") && resourcePath.endsWith("/submit")
                ) || resourcePath === "/api/mini/jobs";
              }
              catch { return false; }
            }),
            resumeAction: Boolean(document.querySelector('.message-assistant [data-action="resume"]')),
            enabledResumeActions: document.querySelectorAll('.message-assistant [data-action="resume"]:not(:disabled)').length,
            response: message?.textContent?.trim() || "",
            responseVisible: Boolean(message && bounds && bounds.width > 0 && bounds.height > 0 && style?.visibility !== "hidden" && style?.display !== "none"),
          };
        })()`);
        const violations = [...new Set(guideReplies.flatMap((reply) => guideReplyViolations(reply)))];
        const hadQuestion = guideSteps.some((item) => item.kind === "question");
        const hadPreview = guideSteps.some((item) => item.kind === "preview" && item.previewCount >= 2);
        const questionSteps = guideSteps.filter((item) => item.kind === "question");
        const firstQuestion = questionSteps[0]?.question || "";
        const adPreviewStep = guideSteps.find((item) => (
          item.kind === "preview"
          && item.previews.length >= 2
          && item.previews.every((preview) => preview.kind === "ad" && preview.text.length > 0)
          && new Set(item.previews.map((preview) => preview.text.toLowerCase())).size >= 2
        ));
        const metaRegressionPassed = !IS_META_REGRESSION || Boolean(
          guideSteps[0]?.kind === "question"
          && /(?:ad|people|customer)/i.test(firstQuestion)
          && /(?:do|happen|action|result|achieve|after|see|book|buy|contact|enquir)/i.test(firstQuestion)
          && adPreviewStep
          && questionSteps.length <= 3
          && conversation.enabledResumeActions === 1
        );
        guideRuns.push({
          run,
          response: conversation.response,
          responseVisible: conversation.responseVisible,
          responseMs: Date.now() - responseStarted,
          withinBudget: checkpoints.complete,
          hasResponse: Boolean(conversation.response),
          resumeAction: conversation.resumeAction,
          bypassedFullBuild: !conversation.statusCard && !conversation.submittedJob,
          submittedJob: conversation.submittedJob,
          enabledResumeActions: conversation.enabledResumeActions,
          guideViolations: violations,
          guidedFlow: { hadQuestion, hadPreview, steps: guideSteps },
          metaRegressionPassed,
          checkpoints,
        });
        // Do not clear/reload a browser while a guide response is still in
        // flight. A later pass could otherwise inherit activity from the
        // earlier customer conversation and produce a false release result.
        if (!checkpoints.complete) {
          throw new Error(`Guide run ${run} did not complete before the next browser reset`);
        }
      }
      // Preserve the existing result shape for callers while recording every
      // visible customer reply for a release receipt.
      result.fastConversation = guideRuns[0];
      result.guideRuns = guideRuns;
    }
    if (SCREENSHOT) {
      const capture = await browser.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      fs.writeFileSync(SCREENSHOT, Buffer.from(capture.data, "base64"));
    }
    console.log(JSON.stringify(result));
    const failedGuideRun = result.guideRuns?.find((run) => (
      !run.withinBudget || !run.hasResponse || !run.responseVisible || !run.resumeAction || !run.bypassedFullBuild || run.guideViolations.length
      || (REQUIRE_GUIDED_FLOW && (!run.guidedFlow.hadQuestion || !run.guidedFlow.hadPreview))
      || !run.metaRegressionPassed
    ));
    if (result.canonicalPath !== "/mini-frank/" || result.hasLegacyPublicPath || result.scrollWidth > result.viewport.width || result.hasLegacyCopy || result.heading.right > result.viewport.width || result.composer.right > result.viewport.width || !result.sendEnabled || failedGuideRun) process.exitCode = 1;
  } finally {
    try { browser?.close(); } catch {}
    chrome.kill();
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
