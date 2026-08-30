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
// A real guide reply currently takes about 32 seconds in production. Keep the
// optional end-to-end check useful without making the normal visual canary wait.
const RESPONSE_BUDGET_MS = Number(process.env.FRANK_BROWSER_RESPONSE_BUDGET_MS || 45000);
const COMPOSER_READY_BUDGET_MS = Number(process.env.FRANK_BROWSER_COMPOSER_READY_BUDGET_MS || 10000);
const [WIDTH, HEIGHT] = WINDOW_SIZE.split(",").map(Number);

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

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
    const composerReady = await waitForEvaluation(browser, `(() => {
      const composer = document.querySelector("#composer");
      const input = document.querySelector("#message");
      const send = composer?.querySelector('[data-action="send-message"]');
      return Boolean(composer && input && !input.disabled && send);
    })()`, Date.now() + COMPOSER_READY_BUDGET_MS);
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
        input.value = "Create a simple booking page for my customers.";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        if (send.disabled || send.dataset.action !== "send-message") return false;
        composer.requestSubmit();
        return true;
      })()`);
      if (!submissionStarted) throw new Error("Composer was no longer ready when the optional submit check began");

      const deadline = responseStarted + RESPONSE_BUDGET_MS;
      checkpoints.accepted = await waitForEvaluation(browser, `(() => {
        const userMessage = document.querySelector(".message-user .message-text");
        const conversation = document.querySelector("#conversation");
        const completed = document.querySelector('.message-assistant [data-action="resume"]');
        return Boolean(userMessage && (
          conversation?.getAttribute("aria-busy") === "true" || completed
        ));
      })()`, deadline);
      if (checkpoints.accepted) checkpoints.acceptedMs = Date.now() - responseStarted;

      checkpoints.complete = checkpoints.accepted && await waitForEvaluation(browser,
        `Boolean(document.querySelector('.message-assistant [data-action="resume"]'))`,
        deadline,
      );
      if (checkpoints.complete) checkpoints.completeMs = Date.now() - responseStarted;
      const conversation = await browser.evaluate(`(() => ({
        statusCard: Boolean(document.querySelector(".status-card")),
        resumeAction: Boolean(document.querySelector('.message-assistant [data-action="resume"]')),
        response: [...document.querySelectorAll(".message-assistant .message-text")].at(-1)?.textContent?.trim() || "",
      }))()`);
      result.fastConversation = {
        responseMs: Date.now() - responseStarted,
        withinBudget: checkpoints.complete,
        hasResponse: Boolean(conversation.response),
        resumeAction: conversation.resumeAction,
        bypassedFullBuild: !conversation.statusCard,
        checkpoints,
      };
    }
    if (SCREENSHOT) {
      const capture = await browser.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      fs.writeFileSync(SCREENSHOT, Buffer.from(capture.data, "base64"));
    }
    console.log(JSON.stringify(result));
    if (result.canonicalPath !== "/mini-frank/" || result.hasLegacyPublicPath || result.scrollWidth > result.viewport.width || result.hasLegacyCopy || result.heading.right > result.viewport.width || result.composer.right > result.viewport.width || !result.sendEnabled || (EXERCISE_SUBMIT && (!result.fastConversation.withinBudget || !result.fastConversation.hasResponse || !result.fastConversation.resumeAction || !result.fastConversation.bypassedFullBuild))) process.exitCode = 1;
  } finally {
    try { browser?.close(); } catch {}
    chrome.kill();
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
