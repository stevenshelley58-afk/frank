const screens = [...document.querySelectorAll("[data-screen]")];
const consolePages = [...document.querySelectorAll("[data-console-page]")];
const consoleHeadName = document.getElementById("console-module-name");
const consoleHeadIcon = document.getElementById("console-module-icon");
const consoleCrumb = document.getElementById("console-module-name-wrap");
const systemTag = document.getElementById("system-tag");
const modal = document.getElementById("command-modal");
const search = document.getElementById("command-search");
const toast = document.getElementById("toast");
let toastTimer;

const names = {
  console: ["", "", ""],
  skills: ["Skills", "SK", "Frank"],
  harness: ["Harness & Gateway", "HG", "Frank"],
  graph: ["Memory Graph", "MG", "Frank"],
  tools: ["Tools & Connectors", "TC", "Frank"]
};

function go(target) {
  const isHome = target === "home";
  screens.forEach((screen) => screen.classList.toggle("active", screen.dataset.screen === (isHome ? "home" : "console-shell")));
  consolePages.forEach((page) => page.classList.toggle("active", page.dataset.consolePage === target));
  const meta = names[target] || names.console;
  consoleHeadName.textContent = meta[0];
  consoleHeadName.style.display = meta[0] ? "flex" : "none";
  consoleCrumb.style.display = meta[0] ? "" : "none";
  consoleHeadName.prepend(consoleHeadIcon);
  consoleHeadIcon.textContent = meta[1];
  systemTag.textContent = meta[2];
  systemTag.style.display = meta[2] ? "" : "none";
  modal.classList.remove("open");
  window.location.hash = target === "home" ? "" : target;
}

document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => go(button.dataset.go)));

function openPalette() {
  modal.classList.add("open");
  setTimeout(() => search.focus(), 20);
}
document.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", openPalette));
modal.addEventListener("click", (event) => { if (event.target === modal) modal.classList.remove("open"); });
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openPalette();
  }
  if (event.key === "Escape") modal.classList.remove("open");
});
search.addEventListener("input", () => {
  const query = search.value.toLowerCase();
  document.querySelectorAll(".palette-item").forEach((item) => {
    item.style.display = item.textContent.toLowerCase().includes(query) ? "" : "none";
  });
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
}

document.querySelectorAll(".switch").forEach((button) => button.addEventListener("click", () => {
  button.classList.toggle("on");
  showToast(button.classList.contains("on") ? "Connector resumed." : "Connector paused. The next use will be blocked.");
}));
document.querySelectorAll(".route-button").forEach((button) => button.addEventListener("click", () => {
  const group = button.closest(".route-buttons");
  group.querySelectorAll(".route-button").forEach((item) => item.classList.remove("active", "accent"));
  button.classList.add("active");
  if (button.textContent.trim() !== "Auto") button.classList.add("accent");
  showToast("Route updated for the next turn.");
}));
document.querySelectorAll(".skill-row").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".skill-row").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
}));
document.querySelectorAll("[data-toast]").forEach((button) => button.addEventListener("click", () => showToast(button.dataset.toast)));

const initial = window.location.hash.replace("#", "");
if (["console", "skills", "harness", "graph", "tools"].includes(initial)) go(initial);
