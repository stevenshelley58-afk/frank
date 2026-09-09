/* Speech-to-text state machine around browser MediaRecorder and Frank's
   contracted transcription endpoint. No browser SpeechRecognition and no
   vendor cloud fallback, ever. Language is server-configured; the browser
   sends {data_url, mime_type?} only. Silence is a neutral result, not an
   error. The 25 MiB limit is decoded audio; the base64 body is larger. */

import * as api from "./api.js";

export const DICTATION_STATES = {
  IDLE: "idle",
  PERMISSION: "requesting-permission",
  RECORDING: "recording",
  UPLOADING: "uploading",
  TRANSCRIBING: "transcribing",
  READY: "ready",
  CANCELLED: "cancelled",
  FAILED: "failed",
};

const MAX_DECODED_BYTES = 25 * 1024 * 1024; /* contract §6: post-decode limit */
const MAX_DURATION_MS = 90_000; /* contract §2: STT hard cap */

const CODECS = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

export class DictationController {
  constructor({ button, onTranscript, onState, onNotice } = {}) {
    this.button = button;
    this.onTranscript = onTranscript || (() => {});
    this.onState = onState || (() => {});
    this.onNotice = onNotice || (() => {});
    this.state = DICTATION_STATES.IDLE;
    this.disposed = false;
    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    this.timer = null;
    this.startedAt = 0;
    this.mimeType = "";
  }

  static supportedCodec() {
    if (typeof MediaRecorder === "undefined") return "";
    return CODECS.find((codec) => MediaRecorder.isTypeSupported?.(codec)) || "";
  }

  #enter(state) {
    if (this.disposed && state !== DICTATION_STATES.IDLE) return;
    this.state = state;
    const recording = state === DICTATION_STATES.RECORDING;
    const busy = [DICTATION_STATES.PERMISSION, DICTATION_STATES.UPLOADING, DICTATION_STATES.TRANSCRIBING].includes(state);
    this.button?.classList.toggle("is-listening", recording);
    this.button?.setAttribute("aria-pressed", recording ? "true" : "false");
    this.button?.setAttribute("aria-label", recording ? "Stop voice input" : "Voice input");
    this.onState(state, this.durationLabel());
  }

  durationLabel() {
    if (this.state !== DICTATION_STATES.RECORDING) return "";
    const seconds = Math.floor((Date.now() - this.startedAt) / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }

  toggle() {
    if (this.state === DICTATION_STATES.RECORDING) void this.stop();
    else if (this.state === DICTATION_STATES.IDLE || this.state === DICTATION_STATES.READY || this.state === DICTATION_STATES.CANCELLED || this.state === DICTATION_STATES.FAILED) void this.start();
  }

  async start() {
    if (this.state !== DICTATION_STATES.IDLE && this.state !== DICTATION_STATES.READY && this.state !== DICTATION_STATES.CANCELLED && this.state !== DICTATION_STATES.FAILED) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.#fail("This browser cannot record audio. Type your message instead.");
      return;
    }
    this.mimeType = DictationController.supportedCodec();
    if (!this.mimeType) {
      this.#fail("This browser cannot record audio in a format Frank can transcribe. Type your message instead.");
      return;
    }
    this.#enter(DICTATION_STATES.PERMISSION);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      if (error?.name === "NotFoundError" || error?.name === "OverconstrainedError" || error?.name === "NotReadableError") {
        this.#fail("No microphone is available. Check that a microphone is connected and not in use.");
      } else if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
        this.#fail("Microphone access was denied. Allow the microphone and try again.");
      } else {
        this.#fail("Recording could not start. Try again.");
      }
      return;
    }
    this.chunks = [];
    this.startedAt = Date.now();
    try {
      this.recorder = new MediaRecorder(this.stream, this.mimeType ? { mimeType: this.mimeType } : undefined);
    } catch {
      this.#cleanupStream();
      this.#fail("Recording could not start with this browser's audio codec.");
      return;
    }
    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) this.chunks.push(event.data);
    });
    this.recorder.addEventListener("stop", () => { void this.#transcribe(); });
    this.recorder.addEventListener("error", () => this.#fail("Recording failed. Try again."));
    this.recorder.start();
    this.#enter(DICTATION_STATES.RECORDING);
    this.timer = setInterval(() => {
      if (this.state !== DICTATION_STATES.RECORDING) return;
      this.onState(this.state, this.durationLabel());
      if (Date.now() - this.startedAt >= MAX_DURATION_MS) {
        this.onNotice("Recording stopped at the 90 second limit.");
        void this.stop();
      }
    }, 1000);
  }

  async stop() {
    if (this.state !== DICTATION_STATES.RECORDING || !this.recorder) return;
    clearInterval(this.timer);
    this.timer = null;
    const elapsed = Date.now() - this.startedAt;
    if (elapsed < 250) {
      await this.cancel();
      this.onNotice("Recording was too short to transcribe.");
      return;
    }
    this.recorder.stop();
  }

  async cancel() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.#cleanupStream();
    this.recorder = null;
    this.chunks = [];
    this.#enter(DICTATION_STATES.CANCELLED);
    this.#enter(DICTATION_STATES.IDLE);
  }

  #cleanupStream() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }

  async #transcribe() {
    this.#cleanupStream();
    this.recorder = null;
    const blob = new Blob(this.chunks, { type: this.mimeType || "audio/webm" });
    this.chunks = [];
    if (blob.size > MAX_DECODED_BYTES) {
      this.#fail(`That recording is too large to transcribe (limit is 25 MB of decoded audio). Record a shorter clip.`);
      return;
    }
    if (!blob.size) {
      this.#enter(DICTATION_STATES.IDLE);
      this.onNotice("Nothing was recorded.");
      return;
    }
    this.#enter(DICTATION_STATES.UPLOADING);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(String(reader.result)));
        reader.addEventListener("error", () => reject(new Error("Recording could not be read.")));
        reader.readAsDataURL(blob);
      });
      this.#enter(DICTATION_STATES.TRANSCRIBING);
      const result = await api.transcribe({ dataUrl, mimeType: this.mimeType });
      if (result?.ok && typeof result.transcript === "string") {
        if (!result.transcript) {
          /* Silence is neutral: leave all composer text unchanged. */
          this.onNotice("No speech heard.");
          this.#enter(DICTATION_STATES.READY);
          this.#enter(DICTATION_STATES.IDLE);
          return;
        }
        this.onTranscript(result.transcript);
        this.#enter(DICTATION_STATES.READY);
        this.#enter(DICTATION_STATES.IDLE);
      } else {
        this.#fail("Transcription was not available just now. Your text is untouched.");
      }
    } catch (error) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") {
        this.#fail("Transcription timed out. Your text is untouched.");
      } else if (error instanceof TypeError) {
        this.#fail("Could not reach Frank. Your text is untouched.");
      } else {
        this.#fail(String(error?.message || "Transcription failed. Your text is untouched."));
      }
    }
  }

  #fail(message) {
    this.onNotice(message);
    this.#enter(DICTATION_STATES.FAILED);
    this.#enter(DICTATION_STATES.IDLE);
  }

  dispose() {
    this.disposed = true;
    clearInterval(this.timer);
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.#cleanupStream();
    this.recorder = null;
  }
}
