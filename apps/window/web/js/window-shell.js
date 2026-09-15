// Presentation-only navigation. Existing Window handlers retain all behavior.
export function matchingNavigation(entries, query) {
  const q = String(query || "")
    .trim()
    .toLocaleLowerCase();
  return entries
    .filter((entry) => entry.label.toLocaleLowerCase().includes(q))
    .slice(0, 30);
}
export function setupWindowShell(doc = document, win = window) {
  const menu = doc.getElementById("shell-navigation");
  const command = doc.getElementById("shell-command");
  const rail = doc.querySelector(".app > .rail");
  if (!menu || !command || !rail) return;
  const app = rail.parentElement;
  const menuTrigger = doc.getElementById("shell-menu");
  const input = doc.getElementById("shell-search-input");
  const results = doc.getElementById("shell-search-results");
  function restoreRail() {
    app.prepend(rail);
    menuTrigger.setAttribute("aria-expanded", "false");
  }
  menuTrigger.setAttribute("aria-expanded", "false");
  menuTrigger.addEventListener("click", () => {
    doc.getElementById("shell-navigation-content").append(rail);
    menu.showModal();
    menuTrigger.setAttribute("aria-expanded", "true");
  });
  doc
    .getElementById("shell-menu-close")
    .addEventListener("click", () => menu.close());
  menu.addEventListener("close", restoreRail);
  rail.addEventListener("click", (event) => {
    if (event.target.closest("button") && menu.open) menu.close();
  });
  win.matchMedia("(min-width: 721px)").addEventListener("change", (event) => {
    if (event.matches && menu.open) menu.close();
  });
  function entries() {
    return [
      ...rail.querySelectorAll(
        ".rail-item[data-view], .project-nav button, .chat-nav-item",
      ),
    ]
      .filter((button) => !button.disabled && !button.closest("[hidden]"))
      .map((button) => ({
        button,
        label:
          button.getAttribute("aria-label") ||
          button.querySelector("strong")?.textContent ||
          button.textContent.trim(),
      }));
  }
  function render() {
    const matches = matchingNavigation(entries(), input.value);
    results.replaceChildren();
    for (const entry of matches) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "shell-search-result";
      button.textContent = entry.label;
      button.addEventListener("click", () => {
        command.close();
        entry.button.click();
      });
      results.append(button);
    }
    if (!matches.length) {
      const p = doc.createElement("p");
      p.className = "shell-search-empty";
      p.textContent = "No matching pages, projects or chats.";
      results.append(p);
    }
  }
  function openSearch() {
    if (command.open || doc.querySelector("dialog[open]")) return;
    input.value = "";
    render();
    command.showModal();
    input.focus();
  }
  doc.getElementById("shell-search").addEventListener("click", openSearch);
  doc
    .getElementById("shell-search-close")
    .addEventListener("click", () => command.close());
  input.addEventListener("input", render);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      results.querySelector("button")?.focus();
    }
    if (event.key === "Enter" && results.children.length === 1)
      results.querySelector("button")?.click();
  });
  command.addEventListener("close", () => {
    input.value = "";
    results.replaceChildren();
  });
  win.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
    }
  });
}
if (typeof document !== "undefined") setupWindowShell();
