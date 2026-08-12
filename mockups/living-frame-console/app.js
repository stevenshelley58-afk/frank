const views = [...document.querySelectorAll("[data-view]")];
const homeSide = document.getElementById("home-side");
const consoleSide = document.getElementById("console-side");
const commandModal = document.getElementById("command-modal");
const commandSearch = document.getElementById("command-search");
const toast = document.getElementById("toast");
let toastTimer;

function navigate(target) {
  views.forEach((view) => view.classList.toggle("active", view.dataset.view === target));
  const inConsole = ["console", "skills", "harness", "graph", "tools"].includes(target);
  homeSide.style.display = inConsole ? "none" : "";
  consoleSide.style.display = inConsole ? "" : "none";
  document.querySelectorAll(".rail-btn[data-go]").forEach((button) => {
    button.classList.toggle("active", button.dataset.go === target || (inConsole && button.dataset.go === "console"));
  });
  document.querySelectorAll(".console-nav-item[data-go]").forEach((button) => {
    button.classList.toggle("active", button.dataset.go === target);
  });
  commandModal.classList.remove("open");
  window.location.hash = target === "home" ? "" : target;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => navigate(button.dataset.go));
});

function openCommand() {
  commandModal.classList.add("open");
  setTimeout(() => commandSearch.focus(), 20);
}

document.querySelectorAll("[data-command]").forEach((button) => button.addEventListener("click", openCommand));
commandModal.addEventListener("click", (event) => {
  if (event.target === commandModal) commandModal.classList.remove("open");
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCommand();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
    event.preventDefault();
    navigate("delegate");
  }
  if (event.key === "Escape") commandModal.classList.remove("open");
});
commandSearch.addEventListener("input", () => {
  const query = commandSearch.value.toLowerCase();
  document.querySelectorAll(".command-item").forEach((item) => {
    item.style.display = item.textContent.toLowerCase().includes(query) ? "" : "none";
  });
});

const modelMenu = document.getElementById("model-menu");
const thinkingMenu = document.getElementById("thinking-menu");
document.getElementById("model-trigger").addEventListener("click", (event) => {
  event.stopPropagation();
  modelMenu.classList.toggle("open");
  thinkingMenu.classList.remove("open");
});
document.getElementById("thinking-trigger").addEventListener("click", (event) => {
  event.stopPropagation();
  thinkingMenu.classList.toggle("open");
  modelMenu.classList.remove("open");
});
document.querySelectorAll("[data-model]").forEach((button) => {
  button.addEventListener("click", () => {
    document.getElementById("model-label").textContent = button.dataset.model;
    document.querySelectorAll("[data-model]").forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
    modelMenu.classList.remove("open");
    showToast(button.dataset.model + " selected for this message only.");
  });
});
document.querySelectorAll("[data-thinking]").forEach((button) => {
  button.addEventListener("click", () => {
    document.getElementById("thinking-label").textContent = button.dataset.thinking;
    document.querySelectorAll("[data-thinking]").forEach((item) => item.classList.remove("selected"));
    button.classList.add("selected");
    thinkingMenu.classList.remove("open");
  });
});
document.addEventListener("click", () => {
  modelMenu.classList.remove("open");
  thinkingMenu.classList.remove("open");
});

document.querySelectorAll("[data-resolve]").forEach((button) => {
  button.addEventListener("click", () => {
    button.textContent = "Approved";
    button.className = "micro-btn done";
    const reject = button.parentElement.querySelector("[data-reject]");
    if (reject) reject.remove();
    showToast("Decision approved. The work item is ready to continue.");
  });
});
document.querySelectorAll("[data-reject]").forEach((button) => {
  button.addEventListener("click", () => {
    const row = button.closest(".frame-row");
    row.style.opacity = ".45";
    button.parentElement.innerHTML = '<span class="tiny-chip">Declined</span>';
    showToast("Decision declined. An honest receipt was recorded.");
  });
});
document.querySelectorAll("[data-stop]").forEach((button) => {
  button.addEventListener("click", () => {
    button.textContent = "Stopping…";
    button.disabled = true;
    setTimeout(() => {
      button.textContent = "Stopped";
      button.className = "micro-btn done";
      showToast("Run stopped. Its receipt is now in today’s ledger.");
    }, 700);
  });
});
document.querySelectorAll(".switch").forEach((button) => {
  button.addEventListener("click", () => {
    button.classList.toggle("on");
    showToast(button.classList.contains("on") ? "Connector resumed." : "Connector paused. Its next use will be blocked honestly.");
  });
});
document.querySelectorAll(".filter-chip").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
  });
});
document.querySelectorAll(".node").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".node").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    showToast(button.textContent.trim().replace(/\s+/g, " ") + " selected · evidenced relations only.");
  });
});
document.querySelector("[data-launch]").addEventListener("click", () => {
  showToast("Workbench started on Auto / code-builder. It will appear in Running now.");
  setTimeout(() => navigate("home"), 900);
});

const initial = window.location.hash.replace("#", "");
if (["console", "skills", "harness", "graph", "tools", "delegate"].includes(initial)) navigate(initial);
