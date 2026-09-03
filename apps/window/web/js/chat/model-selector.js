/* Model selector. Populated only from Frank's projection of Hermes's
   authenticated provider/model options (never a local list). The label
   changes only after Hermes accepts the runtime change; the cached choice is
   reconciled against Hermes on load and an unavailable cached choice is shown
   plainly instead of silently replaced. Grouping/reasoning/service metadata
   comes only from what Hermes reports. */

import * as api from "./api.js";
import { escapeHtml } from "./render.js";

const MODEL_CACHE_KEY = "frank.model";
const PROVIDER_CACHE_KEY = "frank.provider";
const SESSION_CACHE_KEY = "frank.session-models";

function readCache(key, fallback = "") {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeCache(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch { /* private mode: paint only */ }
}

function sessionCache() {
  try {
    const value = JSON.parse(readCache(SESSION_CACHE_KEY, "{}"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/* Schema-check one projected option without running it. */
export function validateModelOption(option) {
  if (!option || typeof option !== "object") return "not an object";
  if (typeof option.id !== "string" || !option.id.trim()) return "missing id";
  if (option.provider !== undefined && typeof option.provider !== "string") return "bad provider";
  if (option.note !== undefined && typeof option.note !== "string") return "bad note";
  if (option.reasoning !== undefined && typeof option.reasoning !== "boolean") return "bad reasoning flag";
  if (option.service_tier !== undefined && typeof option.service_tier !== "string") return "bad service tier";
  if (option.confirmation !== undefined && typeof option.confirmation !== "boolean") return "bad confirmation flag";
  return "";
}

export class ModelSelector {
  constructor({ button, name, menu } = {}) {
    this.button = button;
    this.name = name;
    this.menu = menu;
    this.models = [];
    this.current = { model: readCache(MODEL_CACHE_KEY), provider: readCache(PROVIDER_CACHE_KEY) };
    this.state = "loading";
    this.error = "";
    this.pendingRequest = Promise.resolve();
    this.disposed = false;
    this.onNotice = () => {};
  }

  mount({ onNotice } = {}) {
    this.onNotice = onNotice || this.onNotice;
    this.button?.addEventListener("click", (event) => {
      event.stopPropagation();
      this.menu.classList.toggle("is-open");
      if (this.menu.classList.contains("is-open") && this.state !== "ready") void this.load();
    });
    this.outsideClose = (event) => {
      if (!event.target.closest("#model-pick")) this.menu.classList.remove("is-open");
    };
    document.addEventListener("click", this.outsideClose);
    this.paint();
    this.pendingRequest = this.load();
    return this.pendingRequest;
  }

  /* Reconcile the cached choice against Hermes's live options on load. */
  async load() {
    this.state = "loading";
    this.paint();
    try {
      this.models = await api.fetchModels();
    } catch (error) {
      this.state = "error";
      this.error = error.message || "Hermes models could not be loaded.";
      this.paint();
      return;
    }
    if (!this.models.length) {
      this.state = "empty";
      this.paint();
      return;
    }
    this.state = "ready";
    const invalid = this.models.map((option) => validateModelOption(option)).filter(Boolean);
    if (invalid.length) this.onNotice(`${invalid.length} reported model option${invalid.length === 1 ? " was" : "s were"} malformed and hidden. Refresh to try again.`);
    this.models = this.models.filter((option) => !validateModelOption(option));
    if (!this.models.some((option) => option.id === this.current.model)) {
      if (this.current.model) {
        this.onNotice(`The saved model "${this.current.model}" is not available right now. Choose a model to continue.`);
      }
      this.current = { model: "", provider: "" };
      writeCache(MODEL_CACHE_KEY, "");
    }
    this.paint();
  }

  refresh() {
    return this.load();
  }

  /* Session paint from the durable Hermes session record, before load. */
  applySession(session) {
    if (!session) return;
    const saved = sessionCache()[session.id] || {};
    const model = saved.model || session.model || "";
    if (model && this.models.some((option) => option.id === model)) {
      this.current = { model, provider: saved.provider || session.provider || this.current.provider };
      writeCache(MODEL_CACHE_KEY, this.current.model);
      writeCache(PROVIDER_CACHE_KEY, this.current.provider);
      this.paint();
    }
  }

  rememberSession(chatId) {
    if (!chatId || !this.current.model) return;
    const cache = sessionCache();
    cache[chatId] = { model: this.current.model, provider: this.current.provider };
    writeCache(SESSION_CACHE_KEY, JSON.stringify(cache));
  }

  async select(option) {
    const previous = { ...this.current };
    this.pending = option.id;
    this.paint();
    this.pendingRequest = api.setSessionModel(this.activeChatId, { model: option.id, provider: option.provider || "" })
      .then((result) => {
        const runtime = result?.runtime || {};
        const acceptedModel = String(runtime.model || option.id);
        this.current = { model: acceptedModel, provider: String(runtime.provider || option.provider || previous.provider) };
        writeCache(MODEL_CACHE_KEY, this.current.model);
        writeCache(PROVIDER_CACHE_KEY, this.current.provider);
        if (runtime.prompt_cache_reset) {
          this.onNotice("Hermes reset the prompt cache for this session; the next turn may cost more.");
        }
        if (runtime.reasoning !== undefined) {
          this.onNotice(`Hermes accepted the model with reasoning ${runtime.reasoning ? "enabled" : "disabled"}.`);
        }
        this.rememberSession(this.activeChatId);
      })
      .catch((error) => {
        if (String(error?.message || "").match(/busy|deferred/i)) {
          this.onNotice("Hermes could not switch models while the current run is active. The change will apply when it finishes.");
          this.current = previous;
        } else {
          this.onNotice(error?.message || "Hermes did not accept that model.");
          this.current = previous;
        }
      })
      .finally(() => {
        this.pending = "";
        this.paint();
      });
    await this.pendingRequest;
    return this.current;
  }

  paint() {
    if (!this.menu) return;
    if (this.state === "loading") {
      this.menu.innerHTML = '<p class="model-state">Loading models from Hermes…</p>';
    } else if (this.state === "error") {
      this.menu.innerHTML = `<p class="model-state is-error">${escapeHtml(this.error)}</p>
        <button type="button" class="model-refresh" role="menuitem">Try again</button>`;
    } else if (this.state === "empty") {
      this.menu.innerHTML = '<p class="model-state is-error">Hermes reported no usable models.</p><button type="button" class="model-refresh" role="menuitem">Try again</button>';
    } else {
      const providers = [...new Set(this.models.map((option) => option.provider || ""))];
      this.menu.innerHTML = providers.map((provider) => {
        const options = this.models.filter((option) => (option.provider || "") === provider);
        const caption = provider ? `<div class="model-group">${escapeHtml(provider)}</div>` : "";
        return caption + options.map((option) => {
          const tags = [
            option.note ? escapeHtml(option.note) : "",
            option.reasoning ? "reasoning" : "",
            option.service_tier ? escapeHtml(option.service_tier) : "",
          ].filter(Boolean).join(" · ");
          return `<button type="button" class="model-opt ${option.id === this.current.model ? "is-on" : ""} ${this.pending === option.id ? "is-pending" : ""}" data-id="${escapeHtml(option.id)}" role="menuitem" aria-pressed="${option.id === this.current.model}">
            <span class="mo-name">${escapeHtml(option.id)}</span><span class="mo-note">${tags || (this.pending === option.id ? "checking with Hermes…" : "")}</span>
          </button>`;
        }).join("");
      }).join("");
      this.menu.querySelectorAll(".model-opt").forEach((option) => {
        option.addEventListener("click", () => {
          const chosen = this.models.find((item) => item.id === option.dataset.id);
          if (!chosen) return;
          this.menu.classList.remove("is-open");
          if (chosen.confirmation && !window.confirm(`${chosen.id} is an expensive model. Use it for this session?`)) return;
          void this.select(chosen);
        });
      });
    }
    this.menu.querySelector(".model-refresh")?.addEventListener("click", () => void this.refresh());
    if (this.name) {
      this.name.textContent = this.current.model || (this.state === "ready" ? "choose model" : "model");
      this.name.classList.toggle("is-unset", !this.current.model);
    }
  }

  dispose() {
    this.disposed = true;
    document.removeEventListener("click", this.outsideClose);
  }
}
