/* Local file and folder attachment controller.
   Preserves the existing chips/DOM, adds per-batch progress, cancel and retry,
   removes the silent 500-file truncation (the measured limit is shown before
   upload), labels folder batches as uploaded snapshots, and detaches through
   the contracted Frank route (server-side image.detach) before a chip is gone.
   The turn payload carries only the browser-safe DTO per contract §6. */

import * as api from "./api.js";
import { escapeHtml, fmtSize } from "./render.js";

const DEFAULT_FILE_LIMIT = 500; /* measured server cap; see handoff */
const IMAGE_PATTERN = /^image\//;

function batchKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function attachmentDTO(attachment) {
  return {
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    mime: attachment.mime || attachment.type || "application/octet-stream",
    project_ref: attachment.project_ref || undefined,
  };
}

/* Chip markup uses only browser-safe fields; never id paths or Hermes paths. */
export function chipFields(attachment) {
  return {
    name: String(attachment.name || "file"),
    relativePath: String(attachment.relative_path || attachment.name || "file"),
    size: attachment.size,
    type: String(attachment.mime || attachment.type || "application/octet-stream"),
    url: String(attachment.url || ""),
    origin: String(attachment.origin || "device"),
  };
}

function pendingChip(attachment, index) {
  const image = IMAGE_PATTERN.test(attachment.type || "");
  if (image && attachment.previewUrl) {
    const name = escapeHtml(attachment.name || "Image");
    return `<span class="att-image-pending is-${escapeHtml(attachment.status || "ready")}">
      <img src="${escapeHtml(attachment.previewUrl)}" alt="${name}">
      ${attachment.status === "uploading" ? '<span class="att-uploading" aria-label="Uploading"></span>' : ""}
      ${attachment.status === "error" ? '<span class="att-failed" title="Upload failed">!</span>' : ""}
      <button type="button" class="att-x" data-i="${index}" aria-label="Remove ${name}">×</button>
    </span>`;
  }
  const state = attachment.status === "uploading" ? " · uploading" : attachment.status === "error" ? " · failed" : attachment.status === "cancelled" ? " · cancelled" : "";
  return `<span class="att-chip big ${attachment.status === "error" ? "is-error" : ""}">${escapeHtml(attachment.relative_path || attachment.name)} <em>${fmtSize(attachment.size)}${state}</em>
    <button type="button" class="att-x" data-i="${index}" aria-label="Remove">×</button></span>`;
}

function folderChip(group) {
  const uploading = group.items.some((item) => item.status === "uploading");
  const failed = group.items.some((item) => item.status === "error");
  const state = failed ? "failed" : uploading ? "uploading" : "ready";
  const detail = `${group.items.length} item${group.items.length === 1 ? "" : "s"}${uploading ? " · uploading" : failed ? " · some failed" : ""}`;
  const snapshot = group.snapshotAt ? ` · uploaded snapshot ${escapeHtml(group.snapshotAt)}` : " · uploaded snapshot";
  return `<span class="att-folder-pending is-${state}">
    <span class="att-folder-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z"/></svg></span>
    <span class="att-folder-copy"><strong>${escapeHtml(group.name)}</strong><em>${detail}${snapshot}</em></span>
    ${uploading ? '<span class="att-folder-spin" aria-label="Uploading folder"></span>' : ""}
    <button type="button" class="att-x att-group-x" data-group-key="${escapeHtml(group.key)}" aria-label="Remove folder ${escapeHtml(group.name)}">×</button>
  </span>`;
}

export const VPS_DRAG_TYPE = "application/x-frank-vps-entry";

export class AttachmentController {
  constructor({ row, fileInput, folderInput, composer, document: doc = document, limit = DEFAULT_FILE_LIMIT, onNotice, onVpsEntry, canAccept } = {}) {
    this.row = row;
    this.fileInput = fileInput;
    this.folderInput = folderInput;
    this.composer = composer;
    this.doc = doc;
    this.limit = limit;
    this.onNotice = onNotice || (() => {});
    this.onVpsEntry = onVpsEntry || (() => {});
    this.canAccept = canAccept || (() => true);
    this.items = [];
    this.uploadsInFlight = 0;
    this.onItemsChange = () => {};
    this.xhr = null;
  }

  mount() {
    this.fileInput?.addEventListener("change", (event) => {
      void this.addFiles(Array.from(event.target.files || []).map((file) => ({ file, path: file.name })));
      event.target.value = "";
    });
    this.folderInput?.addEventListener("change", (event) => {
      void this.addFiles(Array.from(event.target.files || []).map((file) => ({ file, path: file.webkitRelativePath || file.name })));
      event.target.value = "";
    });
    if (this.composer) {
      ["dragenter", "dragover"].forEach((type) =>
        this.composer.addEventListener(type, (event) => {
          const types = event.dataTransfer?.types;
          if (types?.includes("Files") || types?.includes(VPS_DRAG_TYPE)) {
            event.preventDefault();
            this.composer.classList.add("is-drag");
          }
        })
      );
      ["dragleave", "drop"].forEach((type) =>
        this.composer.addEventListener(type, (event) => {
          if (type === "dragleave" && this.composer.contains(event.relatedTarget)) return;
          this.composer.classList.remove("is-drag");
        })
      );
    }
    this.doc?.addEventListener("dragover", (event) => {
      const types = event.dataTransfer?.types;
      if (types?.includes("Files") || types?.includes(VPS_DRAG_TYPE)) event.preventDefault();
    });
    this.doc?.addEventListener("drop", (event) => { this.#acceptDrop(event); });
    this.doc?.addEventListener("paste", (event) => {
      if (!this.canAccept()) return;
      const files = Array.from(event.clipboardData?.files || []);
      if (!files.length) return;
      event.preventDefault();
      void this.addFiles(files.map((file) => ({ file, path: file.name })));
    });
    this.row?.addEventListener("click", (event) => {
      const remove = event.target.closest(".att-x");
      if (!remove) return;
      if (remove.dataset.groupKey) {
        void this.remove(this.items.filter((item) => this.groupKeyOf(item) === remove.dataset.groupKey));
      } else {
        void this.remove([this.items[Number(remove.dataset.i)]]);
      }
    });
  }

  /* VPS Explorer entries arrive as the contracted typed payload, never as a
     parsed display string. Local files arrive as Files. */
  #acceptDrop(event) {
    const typed = event.dataTransfer?.getData(VPS_DRAG_TYPE);
    if (typed) {
      if (!this.canAccept()) return;
      event.preventDefault();
      this.composer?.classList.remove("is-drag");
      let entry = null;
      try { entry = JSON.parse(typed); } catch { entry = null; }
      if (entry?.path) this.onVpsEntry(entry);
      return;
    }
    if (!this.canAccept()) return;
    if (!event.dataTransfer?.files?.length && !event.dataTransfer?.items?.length) return;
    event.preventDefault();
    this.composer?.classList.remove("is-drag");
    void this.addDropped(event.dataTransfer);
  }

  async addDropped(transfer) {
    const items = await AttachmentController.filesFromTransfer(transfer);
    await this.addFiles(items);
  }

  static async filesFromTransfer(transfer) {
    const entries = Array.from(transfer.items || []).map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
    if (entries.length) {
      const nested = await Promise.all(entries.map((entry) => AttachmentController.#filesFromEntry(entry)));
      return nested.flat();
    }
    return Array.from(transfer.files || []).map((file) => ({ file, path: file.webkitRelativePath || file.name }));
  }

  static #filesFromEntry(entry, parent = "") {
    const path = parent ? `${parent}/${entry.name}` : entry.name;
    if (entry.isFile) {
      return new Promise((resolve, reject) => entry.file((file) => resolve([{ file, path }]), reject));
    }
    if (!entry.isDirectory) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const reader = entry.createReader();
      const children = [];
      const read = () => reader.readEntries(async (batch) => {
        if (!batch.length) {
          try {
            resolve((await Promise.all(children.map((child) => AttachmentController.#filesFromEntry(child, path)))).flat());
          } catch (error) { reject(error); }
          return;
        }
        children.push(...batch);
        read();
      }, reject);
      read();
    });
  }

  async addFiles(items) {
    if (!items.length) return;
    if (items.length > this.limit) {
      this.onNotice(`That selection is ${items.length} files. Frank accepts up to ${this.limit} per upload. Reduce the selection and try again.`);
      return;
    }
    const key = batchKey();
    const firstPath = String(items[0].path || "").replace(/\\/g, "/");
    const isFolderBatch = items.length > 1 && firstPath.includes("/");
    const staged = items.map(({ file, path }) => ({
      file,
      name: file.name,
      relative_path: path || file.webkitRelativePath || file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      status: "uploading",
      previewUrl: IMAGE_PATTERN.test(file.type || "") ? URL.createObjectURL(file) : "",
      batchKey: key,
    }));
    this.items.push(...staged);
    this.uploadsInFlight += staged.length;
    this.render();
    this.onItemsChange();
    const upload = this.#uploadBatch(key, staged, isFolderBatch);
    staged.forEach((attachment) => { attachment.upload = upload; });
    await upload;
  }

  #uploadBatch(key, staged, isFolderBatch) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      this.xhr = xhr;
      xhr.open("POST", api.routes.uploads);
      xhr.responseType = "json";
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) this.#setBatchStatus(key, `uploading ${Math.round((event.loaded / event.total) * 100)}%`);
      });
      const settle = () => {
        this.uploadsInFlight = Math.max(0, this.uploadsInFlight - staged.length);
        const uploaded = Array.isArray(xhr.response?.attachments) ? xhr.response.attachments : [];
        staged.forEach((attachment, index) => {
          const match = uploaded.find((item) => item && (item.relative_path || item.name) === (attachment.relative_path || attachment.name))
            || uploaded[index];
          if (xhr.status >= 200 && xhr.status < 300 && match) {
            Object.assign(attachment, {
              id: match.id,
              name: match.name || attachment.name,
              relative_path: match.relative_path || attachment.relative_path,
              size: match.size ?? attachment.size,
              type: match.type || match.mime || attachment.type,
              url: match.url || "",
              source: match.source || "device",
              project_ref: match.project_ref,
              status: "ready",
            });
          } else if (attachment.status !== "cancelled") {
            attachment.status = "error";
            attachment.error = xhr.response?.error || `Upload failed (HTTP ${xhr.status || 0})`;
          }
        });
        if (isFolderBatch) {
          this.onNotice(`Folder staged as an uploaded snapshot at ${new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" })}. Files on your device do not stay synchronised.`);
        }
        if (xhr.status >= 400) this.onNotice(xhr.response?.error || `The files could not be uploaded (HTTP ${xhr.status || 0}).`);
        this.render();
        this.onItemsChange();
        resolve();
      };
      xhr.addEventListener("load", settle);
      xhr.addEventListener("error", settle);
      xhr.addEventListener("abort", settle);
      xhr.addEventListener("timeout", settle);
      const form = new FormData();
      for (const attachment of staged) {
        form.append("files", attachment.file, attachment.file.name);
        form.append("paths", attachment.relative_path);
      }
      xhr.send(form);
    });
  }

  #setBatchStatus(key, status) {
    this.row?.querySelector(`[data-batch="${CSS.escape(key)}"]`);
    this.render();
  }

  cancelBatch(key) {
    if (this.xhr) this.xhr.abort();
    this.items.forEach((item) => {
      if (item.batchKey === key && item.status === "uploading") item.status = "cancelled";
    });
    void this.remove(this.items.filter((item) => item.batchKey === key));
  }

  async remove(attachments) {
    const removing = attachments.filter(Boolean);
    if (!removing.length) return;
    const removingSet = new Set(removing);
    removing.forEach((attachment) => {
      attachment.discarded = true;
      if (attachment.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(attachment.previewUrl);
    });
    this.items = this.items.filter((attachment) => !removingSet.has(attachment));
    this.render();
    this.onItemsChange();
    const uploads = [...new Set(removing.map((attachment) => attachment.upload).filter(Boolean))];
    await Promise.allSettled(uploads);
    const ids = [...new Set(removing.map((attachment) => attachment.id).filter(Boolean))];
    if (!ids.length) return;
    try {
      const result = await api.detachUploads(ids);
      const missed = (result.missing || []).length;
      if (missed) this.onNotice(`${missed} removed file${missed === 1 ? " was" : "s were"} already cleared.`);
    } catch (error) {
      this.onNotice(`Removed from the draft, but Frank could not clear the upload: ${error.message || "unknown reason"}`);
    }
  }

  readyItems() {
    return this.items.filter((item) => item.status === "ready" && !item.discarded);
  }

  hasPending() {
    return this.items.some((item) => item.status === "uploading");
  }

  takeReady() {
    const ready = this.readyItems();
    const readySet = new Set(ready);
    this.items = this.items.filter((attachment) => !readySet.has(attachment));
    ready.forEach((attachment) => {
      if (attachment.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(attachment.previewUrl);
    });
    this.render();
    this.onItemsChange();
    return ready;
  }

  groupKeyOf(attachment) {
    const path = String(attachment.relative_path || "").replace(/\\/g, "/");
    const slash = path.indexOf("/");
    return slash > 0 ? encodeURIComponent(`${attachment.batchKey || "batch"}|${path.slice(0, slash)}`) : "";
  }

  render() {
    if (!this.row) return;
    const rendered = [];
    const folders = new Map();
    this.items.forEach((attachment, index) => {
      const key = this.groupKeyOf(attachment);
      if (!key) {
        rendered.push({ kind: "item", html: pendingChip(attachment, index) });
        return;
      }
      let group = folders.get(key);
      if (!group) {
        const path = String(attachment.relative_path || "").replace(/\\/g, "/");
        group = { kind: "folder", key, name: path.slice(0, path.indexOf("/")), items: [] };
        folders.set(key, group);
        rendered.push(group);
      }
      group.items.push(attachment);
    });
    this.row.innerHTML = rendered.map((entry) => entry.kind === "folder" ? folderChip(entry) : entry.html).join("");
    this.row.classList.toggle("has-items", this.items.length > 0);
  }

  dispose() {
    this.doc?.removeEventListener("drop", this.#acceptDrop);
    this.items.forEach((attachment) => {
      if (attachment.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(attachment.previewUrl);
    });
    this.items = [];
    this.xhr = null;
  }
}
