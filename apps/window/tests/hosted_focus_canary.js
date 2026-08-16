/* VPS-only browser assertion for modal navigation focus. */
const { spawn } = require("node:child_process");
const fs = require("node:fs");

const BASE_URL = (process.env.FRANK_BROWSER_URL || "http://127.0.0.1:18080").replace(/\/$/, "");
const PORT = Number(process.env.FRANK_BROWSER_PORT || 9229);
const CHROME = process.env.CHROME_BIN || "google-chrome";
const PROFILE = `/tmp/frank-focus-browser-${process.pid}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopChrome(chrome) {
  return new Promise((resolve) => {
    if (chrome.exitCode !== null) {
      resolve();
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      try { chrome.kill("SIGKILL"); } catch {}
      finish();
    }, 1500);
    chrome.once("exit", finish);
    try { chrome.kill("SIGTERM"); } catch { finish(); }
  });
}

async function waitForDevTools() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome DevTools did not start");
}

async function openPage() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(BASE_URL)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Chrome could not open candidate (${response.status})`);
  return response.json();
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let nextId = 1;
    socket.addEventListener("open", () => resolve({
      evaluate(expression) {
        return new Promise((resolveResult, rejectResult) => {
          const id = nextId++;
          pending.set(id, { resolve: resolveResult, reject: rejectResult });
          socket.send(JSON.stringify({
            id,
            method: "Runtime.evaluate",
            params: { expression, awaitPromise: true, returnByValue: true },
          }));
        });
      },
      close() { socket.close(); },
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result?.result?.value);
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluateWithRetry(browser, expression) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await browser.evaluate(expression);
    } catch (error) {
      lastError = error;
      if (!/execution context was destroyed/i.test(String(error?.message || error))) throw error;
      await sleep(500);
    }
  }
  throw lastError;
}

async function removeProfile() {
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      if (!fs.existsSync(PROFILE)) {
        await sleep(500);
        if (!fs.existsSync(PROFILE)) return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  if (fs.existsSync(PROFILE)) throw lastError || new Error(`Chrome profile cleanup failed: ${PROFILE}`);
}

async function main() {
  const chrome = spawn(CHROME, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "about:blank",
  ], { stdio: "ignore" });
  let browser;
  try {
    await waitForDevTools();
    const page = await openPage();
    browser = await connect(page.webSocketDebuggerUrl);
    const result = await evaluateWithRetry(browser, `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      await wait(1400);
      window.dispatchEvent(new CustomEvent("frank:widget-builder"));
      await wait(500);
      const opener = document.querySelector("#top-actions button");
      opener?.focus();
      opener?.click();
      await wait(150);
      const editor = document.querySelector("#widget-builder-editor");
      const opened = !editor?.hidden;
      editor?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      await wait(100);
      const directRestored = Boolean(editor?.hidden && document.activeElement === opener && document.querySelectorAll("[inert]").length === 0);
      opener?.focus();
      opener?.click();
      await wait(150);
      window.dispatchEvent(new CustomEvent("frank:view", { detail: "accounts" }));
      await wait(150);
      return {
        opened,
        directRestored,
        editorHidden: Boolean(document.querySelector("#widget-builder-editor")?.hidden),
        view: document.querySelector(".view.is-on")?.dataset.view || "",
        activeElement: document.activeElement?.id || "",
        titleTabIndex: document.querySelector("#view-title")?.getAttribute("tabindex") || "",
        inertCount: document.querySelectorAll("[inert]").length,
      };
    })()`);
    if (!result.opened || !result.directRestored || !result.editorHidden || result.view !== "accounts" || result.activeElement !== "view-title" || result.titleTabIndex !== "-1" || result.inertCount !== 0) {
      throw new Error(`focus assertion failed: ${JSON.stringify(result)}`);
    }
    console.log(JSON.stringify({ status: "pass", ...result }));
  } finally {
    try { browser?.close(); } catch {}
    await stopChrome(chrome);
    await sleep(500);
    await removeProfile();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
