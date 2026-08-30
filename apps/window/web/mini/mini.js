import { isAssistantCompleted, parseSseBlock, streamPiece } from "./mini_stream.mjs";
import { MiniApiError, createMiniApi } from "./mini_api.mjs";
import { normalizeResultGuidance, resultGuidanceMarkup, selfHostGuideMarkup } from "./mini_result.mjs";
import { createReplayKeyTracker } from "./mini_retry.mjs";

(function () {
  "use strict";

  const PROJECT_STORE = "mini_frank_project_site_projects_v1";
  const DRAFT_STORE = "mini_frank_project_site_conversation_v1";
  const ACCOUNT_STORE = "mini_frank_account_claim_v1";
  const MAX_SAVED_MESSAGES = 200;
  const MESSAGE_MAX_LENGTH = 4000;
  const CHANGE_MAX_LENGTH = 2000;
  const SERVICE_NOTE_MAX_LENGTH = 2000;
  const GUIDE_IDLE_TIMEOUT_MS = 60000;
  const STATUS_POLL_BASE_MS = 8000;
  const STATUS_POLL_HIDDEN_MS = 30000;
  const STATUS_POLL_OFFLINE_MS = 60000;
  // Keep this client-only delivery change instantly reversible while it is evaluated.
  const ENABLE_QUIET_STREAM_DELIVERY = true;
  // A reader must return to the actual end before reply delivery follows again.
  const STREAM_END_TOLERANCE_PX = 4;
  const DEFAULT_LIMITS = {
    max_count: 10,
    max_file_bytes: 20 * 1024 * 1024,
    max_total_bytes: 50 * 1024 * 1024,
  };

  const conversation = document.getElementById("conversation");
  const thread = document.getElementById("thread");
  const welcome = document.getElementById("welcome");
  const projectReceipt = document.getElementById("project-receipt");
  const projectReceiptTitle = document.getElementById("project-receipt-title");
  const projectReceiptDetails = document.getElementById("project-receipt-details");
  const messages = document.getElementById("messages");
  const endMarker = document.getElementById("end-marker");
  const jumpToLatestButton = document.getElementById("jump-to-latest");
  const composerDock = document.getElementById("composer-dock");
  const composer = document.getElementById("composer");
  const messageInput = document.getElementById("message");
  const composerStatus = document.getElementById("composer-status");
  const fileInput = document.getElementById("file-input");
  const attachmentList = document.getElementById("attachment-list");
  const attachButton = composer.querySelector('[data-action="attach"]');
  const sendButton = composer.querySelector(".send-button");
  const brandMark = document.querySelector(".brand-mark");
  const drawer = document.getElementById("work-drawer");
  const workList = document.getElementById("work-list");
  const toast = document.getElementById("toast");
  const replyAnnouncement = document.getElementById("reply-announcement");
  const draftDeleteButton = document.querySelector('[data-action="delete-draft"]');
  const solutionStarters = document.getElementById("solution-starters");
  const guideDialog = document.getElementById("solution-guide");
  const guideStage = document.getElementById("guide-stage");
  const guideFoot = document.getElementById("guide-foot");
  const guideCount = document.getElementById("guide-count");
  const guideProgressBar = document.getElementById("guide-progress-bar");
  const siteHeader = document.getElementById("site-header");
  const finalComposer = document.getElementById("final-composer");
  const finalProblem = document.getElementById("final-problem");
  const tipDialog = document.getElementById("tip-dialog");
  const tipForm = document.getElementById("tip-form");
  const tipStatus = document.getElementById("tip-status");
  const tipSubmit = document.getElementById("tip-submit");
  const tipAmounts = tipForm.querySelector(".tip-amounts");
  const customTip = document.getElementById("custom-tip");
  const customTipAmount = document.getElementById("custom-tip-amount");
  const shareDialog = document.getElementById("share-dialog");
  const shareForm = document.getElementById("share-form");
  const shareStatus = document.getElementById("share-status");
  const shareSubmit = document.getElementById("share-submit");
  const shareList = document.getElementById("share-list");
  const sharePeopleField = document.getElementById("share-people-field");
  const selfHostDialog = document.getElementById("self-host-dialog");
  const selfHostContent = document.getElementById("self-host-content");
  const serviceDialog = document.getElementById("service-dialog");
  const serviceForm = document.getElementById("service-form");
  const serviceStatus = document.getElementById("service-status");
  const serviceSubmit = document.getElementById("service-submit");
  const serviceHandoff = document.getElementById("service-handoff");
  const serviceContactMethod = document.getElementById("service-contact-method");
  const serviceContactValue = document.getElementById("service-contact-value");
  const serviceContactNotice = document.getElementById("service-contact-notice");

  let intakePromise = null;
  let uploadChain = Promise.resolve();
  let guideController = null;
  let guideAbortReason = "";
  let mutationController = null;
  let mutationAbortReason = "";
  let pendingMutation = null;

  const state = {
    config: {
      attachments: { ...DEFAULT_LIMITS },
    },
    phase: "problem",
    intake: null,
    attachments: [],
    transcript: [],
    problem: "",
    pendingChange: "",
    userTurns: 0,
    refining: false,
    busy: false,
    generation: 0,
    timer: null,
    current: null,
    accountClaim: "",
    publicShare: null,
    jobMessage: null,
    lastStage: "",
    pollFailures: 0,
    workRefreshing: false,
    followingLatest: true,
    newReplyPending: false,
    streamFrame: null,
    threadScrollFrame: null,
    replyAnnouncementFrame: null,
    shares: [],
    sharing: null,
    shareCapability: "unknown",
    serviceCapability: "unknown",
    serviceOptions: null,
    editingShareId: "",
    dialogTriggers: new Map(),
  };
  state.accountClaim = readAccountClaim();

  if (!ENABLE_QUIET_STREAM_DELIVERY) {
    messages.setAttribute("aria-live", "polite");
    messages.setAttribute("aria-relevant", "additions text");
  }

  const api = createMiniApi();
  const sharedCommentReplay = createReplayKeyTracker(mutationKey);
  const serviceRequestReplay = createReplayKeyTracker(mutationKey);

  const fileIcon = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7zM14 3v5h5"/></svg>';
  const closeIcon = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>';
  const sendIcon = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 12 6-6 6 6M12 6v12"/></svg>';
  const stopIcon = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 8h8v8H8z"/></svg>';
  const solutionPrompts = {
    leads: "I want to convert more enquiries into paying customers.",
    admin: "I want to automate a repetitive admin task that takes time every week.",
    cash: "I want to make it easier for customers to pay on time.",
    numbers: "I want one simple view of what needs attention in my business.",
    service: "I want to improve how we answer and help customers.",
    knowledge: "I want to turn staff know-how into simple guides everyone can reuse.",
  };
  const guideAnswers = {
    presence: "Website",
    businessUrl: "",
    wantsWebsite: "Yes, include a website",
    source: "Everywhere",
    business: "North & Co.",
    promise: "Tell us what you need and we will get back to you today.",
    reply: "Thanks for getting in touch. I have your details and will reply shortly.",
    look: "Warm and welcoming",
  };
  let workedGuideStep = 0;

  function leadPreview() {
    return `<div class="mini-shot" aria-label="Example enquiry follow-up screen">
      <div class="mini-shot-head"><span class="brand-mark" aria-hidden="true"></span>North &amp; Co. enquiries <span>3 need a reply</span></div>
      <div class="lead-preview">
        <div class="preview-list">
          <span class="preview-label">New enquiries</span>
          <div class="preview-lead is-active"><i>AM</i><span><strong>Alex Morgan</strong><small>Asked for a price</small></span><small>8 min</small></div>
          <div class="preview-lead"><i>JS</i><span><strong>Jamie Singh</strong><small>Website enquiry</small></span><small>1 hr</small></div>
          <div class="preview-lead"><i>RL</i><span><strong>Riley Lee</strong><small>Needs a call back</small></span><small>Yesterday</small></div>
        </div>
        <div class="preview-detail">
          <small>Next simple action</small><h4>Reply to Alex</h4><p>Alex wants a price and prefers email.</p>
          <div class="preview-reply">Hi Alex, thanks for getting in touch. I can help with that. Here is what happens next...</div>
          <span class="preview-button">Send reply</span>
        </div>
      </div>
    </div>`;
  }

  function guideWork(step) {
    if (step === 0) return `<div class="guide-card"><h3>See the customer view and the follow-up view</h3><p>This worked example explores a customer-facing page and one tidy place to see enquiries.</p>${leadPreview()}</div>`;
    if (step === 1) {
      const choices = [
        ["Website", "Use your current site as the starting point"],
        ["Facebook page", "Use the page customers already know"],
        ["No site or page", "Start fresh with your business details"],
      ];
      const hasReference = guideAnswers.presence !== "No site or page";
      return `<div class="guide-card"><h3>What can Frank look at?</h3><p>This helps the result look and sound like your business.</p><div class="guide-options guide-options-three">${choices.map(([label, detail]) => `<button class="guide-option" type="button" aria-pressed="${guideAnswers.presence === label}" data-guide-action="choose" data-guide-key="presence" data-guide-value="${esc(label)}"><strong>${esc(label)}</strong><span>${esc(detail)}</span></button>`).join("")}</div>${hasReference ? `<div class="guide-field reference-field"><label for="guide-business-url">Paste the ${guideAnswers.presence.toLowerCase()} address</label><input id="guide-business-url" type="url" inputmode="url" data-guide-field="businessUrl" value="${esc(guideAnswers.businessUrl)}" placeholder="https://..."><small>Add this as a visual and wording reference in the project brief.</small></div>` : `<div class="website-choice"><p>Would you like a simple website included?</p><div class="choice-row"><button class="secondary-button" type="button" aria-pressed="${guideAnswers.wantsWebsite === "Yes, include a website"}" data-guide-action="choose" data-guide-key="wantsWebsite" data-guide-value="Yes, include a website">Yes, include a website</button><button class="secondary-button" type="button" aria-pressed="${guideAnswers.wantsWebsite === "Not right now"}" data-guide-action="choose" data-guide-key="wantsWebsite" data-guide-value="Not right now">Not right now</button></div></div>`}</div>`;
    }
    if (step === 2) {
      const choices = [
        ["Website form", "People fill in a form"],
        ["Email inbox", "People send an email"],
        ["Calls or messages", "You write down their details"],
        ["Everywhere", "They arrive in several places"],
      ];
      return `<div class="guide-card"><h3>Pick the closest answer</h3><p>It does not need to be exact. You can change this later.</p><div class="guide-options">${choices.map(([label, detail]) => `<button class="guide-option" type="button" aria-pressed="${guideAnswers.source === label}" data-guide-action="choose" data-guide-key="source" data-guide-value="${esc(label)}"><strong>${esc(label)}</strong><span>${esc(detail)}</span></button>`).join("")}</div></div>`;
    }
    if (step === 3) return `<div class="guide-card"><h3>Use words your customers will understand</h3><p>We filled in an example. Change only what matters.</p><div class="guide-fields">
      <div class="guide-field"><label for="guide-business">What should we call the business?</label><input id="guide-business" data-guide-field="business" value="${esc(guideAnswers.business)}"></div>
      <div class="guide-field"><label for="guide-promise">What should customers expect?</label><input id="guide-promise" data-guide-field="promise" value="${esc(guideAnswers.promise)}"></div>
      <div class="guide-field"><label for="guide-reply">What should the instant reply say?</label><textarea id="guide-reply" data-guide-field="reply">${esc(guideAnswers.reply)}</textarea></div>
    </div><div class="guide-example"><strong>Example:</strong> "Thanks - we have your request. Sam will call before 4 pm today."</div></div>`;
    if (step === 4) {
      const looks = ["Warm and welcoming", "Calm and professional", "Bold and direct"];
      return `<div class="guide-card"><h3>Choose by feel</h3><p>There is no design language to learn.</p><div class="look-options">${looks.map((look) => `<button class="look-option" type="button" aria-pressed="${guideAnswers.look === look}" data-guide-action="choose" data-guide-key="look" data-guide-value="${esc(look)}"><span class="look-swatch"></span><strong>${esc(look)}</strong></button>`).join("")}</div></div>`;
    }
    const previewUrl = sitePreviewUrl();
    return `<div class="guide-card site-result"><div class="site-result-head"><div><h3>Your working page preview</h3><p>Try the sample form here, or open the same local preview in its own browser tab.</p></div><button class="secondary-button open-site-button" type="button" data-guide-action="open-site">Open preview</button></div><div class="site-preview-browser"><div class="browser-chrome"><span></span><span></span><span></span><strong>${esc(sitePreviewLabel())}</strong></div><iframe src="${esc(previewUrl)}" title="Working page preview for ${esc(guideAnswers.business)}"></iframe></div><p class="site-result-note">This local preview opens in the browser; it is not a screenshot.</p></div>`;
  }

  function sitePreviewLabel() {
    if (guideAnswers.businessUrl) {
      try { return new URL(guideAnswers.businessUrl).hostname.replace(/^www\./, ""); }
      catch (_error) { return guideAnswers.businessUrl.replace(/^https?:\/\//, "").split("/")[0] || "your-business.com"; }
    }
    return `${guideAnswers.business.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "your-business"}.com`;
  }

  function sitePreviewUrl() {
    const params = new URLSearchParams({
      business: guideAnswers.business,
      promise: guideAnswers.promise,
      reply: guideAnswers.reply,
      look: guideAnswers.look,
    });
    return `/mini-frank/site-preview.html?${params.toString()}`;
  }

  function openSitePreview() {
    const opened = window.open(sitePreviewUrl(), "_blank", "noopener,noreferrer");
    if (!opened) notify("Your browser blocked the new tab. Allow pop-ups, then try again.");
  }

  function renderWorkedGuide() {
    const copy = [
      ["First, see the finish line.", "We will make a customer-facing page and a simple place to catch every enquiry.", "No setup words. No blank page."],
      ["Show us the real business.", "A website or Facebook page gives Frank real colours, words and context to work from.", "If you do not have one, Frank can include a new website."],
      ["Where do enquiries arrive now?", "Choose the answer closest to your day-to-day business.", "Frank can join the pieces later."],
      ["What should customers hear?", "A few plain words make the result feel like it belongs to your business.", "The examples are yours to edit."],
      ["Pick a look by feel.", "You do not need to know fonts, layouts or colour codes.", "It will stay readable on phones and computers."],
      ["This is a local preview.", "Try the sample form here, then open the preview in a normal browser tab.", "Your answers become a starting brief that you can review before sending."],
    ][workedGuideStep];
    guideCount.textContent = `Step ${workedGuideStep + 1} of 6`;
    guideProgressBar.dataset.step = String(workedGuideStep + 1);
    guideStage.innerHTML = `<section class="guide-copy"><h2 id="guide-title">${esc(copy[0])}</h2><p>${esc(copy[1])}</p><small>${esc(copy[2])}</small></section><section class="guide-work">${guideWork(workedGuideStep)}</section>`;
    const atEnd = workedGuideStep === 5;
    guideFoot.innerHTML = `${workedGuideStep === 0 ? '<button class="quiet-button" type="button" data-guide-action="close">Exit example</button>' : '<button class="quiet-button" type="button" data-guide-action="back">Back</button>'}<span class="guide-spacer">Nothing here is permanent.</span>${atEnd ? '<button class="secondary-button" type="button" data-guide-action="restart">Start again</button><button class="primary-button" type="button" data-guide-action="use">Use this design</button>' : '<button class="primary-button" type="button" data-guide-action="next">Continue</button>'}`;
  }

  function openWorkedGuide() {
    workedGuideStep = 0;
    renderWorkedGuide();
    guideDialog.showModal();
  }

  function closeWorkedGuide() {
    if (guideDialog.open) guideDialog.close();
  }

  function useWorkedGuide() {
    const reference = guideAnswers.presence === "No site or page"
      ? (guideAnswers.wantsWebsite === "Yes, include a website" ? "They do not have a website yet, so include a simple public website." : "They do not have a website and do not want one yet; make the enquiry tool open cleanly in a browser.")
      : `Use their ${guideAnswers.presence.toLowerCase()} as the visual and wording reference: ${guideAnswers.businessUrl || "address to be supplied"}.`;
    const prompt = `Help me build a simple enquiry and follow-up tool for ${guideAnswers.business}. ${reference} Enquiries arrive through ${guideAnswers.source.toLowerCase()}. Customers should see: "${guideAnswers.promise}" The instant reply should say: "${guideAnswers.reply}" Make it feel ${guideAnswers.look.toLowerCase()}. Include a customer page that opens in a browser, not just a mockup. Keep everything plain, mobile-friendly and easy for staff to use.`;
    closeWorkedGuide();
    messageInput.value = prompt.slice(0, MESSAGE_MAX_LENGTH);
    resizeComposer();
    messageInput.focus();
    notify("Your answers are ready. Send when you are happy.");
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cleanText(value, limit = 6000) {
    return String(value == null ? "" : value).replace(/\u0000/g, "").trim().slice(0, limit);
  }

  function formatDate(value) {
    const timestamp = Number(value);
    if (!timestamp) return "Not provided";
    try {
      return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(timestamp * 1000));
    } catch (_error) {
      return "Not provided";
    }
  }

  function formatDateTime(value) {
    const timestamp = Number(value);
    if (!timestamp) return "Not provided";
    try {
      return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(timestamp * 1000));
    } catch (_error) {
      return "Not provided";
    }
  }

  function jobNextAction(job) {
    if (job && job.next_action) return cleanText(job.next_action, 180);
    if (!job) return "Open this work to refresh its status.";
    if (job.stage === "ready") return "Open the result or ask for a change.";
    if (job.stage === "needs_attention") return job.retry_available ? "Review the update. Retry is available." : "Review the update.";
    if (job.stage === "queued") return "The service last reported this work as waiting.";
    if (job.stage === "checking") return "The service last reported that it is checking this work.";
    if (job.stage === "working") return "The service last reported this work as in progress.";
    return "Open this work to see what happens next.";
  }

  function hasTimestamp(value) {
    return Number(value) > 0;
  }

  function receiptNow(stage) {
    if (stage === "needs_attention") return "Needs you";
    if (["queued", "working", "checking"].includes(stage)) return "Working";
    if (stage === "ready") return "Ready to use";
    return "Saved";
  }

  // This pure view model deliberately knows nothing about a job's tokens,
  // transcript, files, title, progress, or result contents.
  function receiptViewModel(job) {
    const stage = cleanText(job && job.stage, 80);
    const ready = stage === "ready" && Boolean(job && job.result);
    return {
      aim: cleanText(job && job.problem, 400) || "Not recorded",
      now: receiptNow(stage),
      next: jobNextAction(job),
      updated: hasTimestamp(job && job.updated_at) ? formatDateTime(job.updated_at) : "",
      availability: hasTimestamp(job && job.available_until) ? formatDate(job.available_until) : "",
      ready,
    };
  }

  function receiptMarkup(view) {
    const rows = [
      ["Aim", esc(view.aim)],
      ["Now", `${esc(view.now)}${view.ready ? ' <a href="#current-result">See current result</a>' : ""}`],
      ["Next", esc(view.next)],
    ];
    if (view.updated) rows.push(["Updated", esc(view.updated)]);
    if (view.availability) rows.push(["Availability", esc(view.availability)]);
    return rows.map(([term, description]) => `<dt>${term}</dt><dd>${description}</dd>`).join("");
  }

  function renderReceipt(job) {
    if (!projectReceipt || !projectReceiptDetails || !state.current || !job) return;
    projectReceiptDetails.innerHTML = receiptMarkup(receiptViewModel(job));
    projectReceipt.hidden = false;
  }

  function hideReceipt() {
    if (!projectReceipt || !projectReceiptDetails) return;
    projectReceipt.hidden = true;
    projectReceiptDetails.replaceChildren();
  }

  function ownerReturnEvent(prior, job) {
    if (!prior || !prior.last_opened_stage) return "";
    const wasReadyWithResult = prior.last_opened_stage === "ready" && Boolean(prior.last_opened_had_result);
    const isReadyWithResult = job && job.stage === "ready" && Boolean(job.result);
    if (isReadyWithResult && !wasReadyWithResult) return "ready";
    if (job && job.stage === "needs_attention" && prior.last_opened_stage !== "needs_attention") return "needs_attention";
    return "";
  }

  function workStatusLabel(item, labels) {
    if (item.return_event === "ready") return "Ready since you last opened it";
    if (item.return_event === "needs_attention") return "Needs you since you last opened it";
    return item.refresh_status === "unavailable" ? labels.unavailable : (labels[item.stage] || "Saved");
  }

  function workNextAction(item) {
    return item.refresh_status === "unavailable"
      ? "Try opening this work again when you are online."
      : jobNextAction(item);
  }

  function workRowAccessibleName(item, labels) {
    const title = cleanText(item.title, 180) || "Your solution";
    return cleanText(`Open ${title}. ${workStatusLabel(item, labels)}. Next: ${workNextAction(item)}`, 500);
  }

  function jobRenderPolicy(source) {
    return {
      focusReceipt: source === "work",
      scrollToEnd: source === "start",
    };
  }

  // Deterministic fixtures are available to browser QA with
  // ?qa=return-receipt-fixtures. They cover the local-only return signal,
  // receipt redaction, and the focus/scroll policy without touching storage.
  const RETURN_RECEIPT_FIXTURES = Object.freeze({
    transitions: [
      [{ last_opened_stage: "working", last_opened_had_result: false }, { stage: "ready", result: {} }, "ready"],
      [{ last_opened_stage: "ready", last_opened_had_result: false }, { stage: "ready", result: {} }, "ready"],
      [{ last_opened_stage: "ready", last_opened_had_result: true }, { stage: "ready", result: {} }, ""],
      [{ last_opened_stage: "working", last_opened_had_result: false }, { stage: "needs_attention" }, "needs_attention"],
      [{ last_opened_stage: "needs_attention", last_opened_had_result: false }, { stage: "needs_attention" }, ""],
      [null, { stage: "ready", result: {} }, ""],
    ],
    receipt: {
      job: {
        problem: "Stop chasing quote follow-ups",
        stage: "ready",
        result: {},
        next_action: "Open the result.",
        updated_at: 1735689600,
        available_until: 1738368000,
        claim: "must-not-appear",
        conversation: "must-not-appear",
        attachments: "must-not-appear",
      },
      forbidden: ["must-not-appear", "claim", "conversation", "attachments"],
    },
  });

  function returnReceiptFixtureFailures() {
    const failures = [];
    RETURN_RECEIPT_FIXTURES.transitions.forEach(([prior, job, expected], index) => {
      if (ownerReturnEvent(prior, job) !== expected) failures.push(`transition-${index}`);
    });
    const receipt = receiptMarkup(receiptViewModel(RETURN_RECEIPT_FIXTURES.receipt.job));
    if (RETURN_RECEIPT_FIXTURES.receipt.forbidden.some((value) => receipt.includes(value))) failures.push("receipt-redaction");
    if (!receipt.includes('href="#current-result"')) failures.push("receipt-result-link");
    if (!jobRenderPolicy("work").focusReceipt || jobRenderPolicy("work").scrollToEnd) failures.push("work-focus-policy");
    if (jobRenderPolicy("direct").focusReceipt || jobRenderPolicy("direct").scrollToEnd) failures.push("direct-focus-policy");
    if (jobRenderPolicy("poll").focusReceipt || jobRenderPolicy("poll").scrollToEnd) failures.push("poll-scroll-policy");
    if (!jobRenderPolicy("start").scrollToEnd) failures.push("start-scroll-policy");
    const workLabels = { ready: "Ready", unavailable: "Could not refresh" };
    const workName = workRowAccessibleName({
      title: "Quote follow-up",
      stage: "ready",
      result: {},
      return_event: "ready",
      refresh_status: "live",
      next_action: "Open the result.",
    }, workLabels);
    if (!workName.includes("Quote follow-up") || !workName.includes("Ready since you last opened it") || !workName.includes("Open the result.")) failures.push("work-row-accessible-name");
    if (jobNextAction({ stage: "queued" }) !== "The service last reported this work as waiting.") failures.push("queued-next-action");
    if (jobNextAction({ stage: "working" }) !== "The service last reported this work as in progress.") failures.push("working-next-action");
    if (jobNextAction({ stage: "needs_attention", retry_available: false }) !== "Review the update.") failures.push("attention-next-action");
    return failures;
  }

  function jobCanDelete(job) {
    return Boolean(state.config.delete_available || (job && (job.delete_available || job.can_delete)));
  }

  function jobCanRevoke(job) {
    return Boolean(state.config.revoke_available || (job && (job.revoke_available || job.can_revoke)));
  }

  function validId(value) {
    return /^[A-Za-z0-9_-]{6,120}$/.test(String(value || ""));
  }

  function validClaim(value) {
    return /^[A-Za-z0-9_-]{20,300}$/.test(String(value || ""));
  }

  function validAccountClaim(value) {
    const claim = String(value || "");
    return claim.length <= 300 && /^ma1\.[A-Za-z0-9_-]{8,180}\.[A-Za-z0-9_-]{20,180}$/.test(claim);
  }

  function readAccountClaim() {
    try {
      const value = localStorage.getItem(ACCOUNT_STORE) || "";
      return validAccountClaim(value) ? value : "";
    } catch (_error) {
      return "";
    }
  }

  function rememberAccountClaim(value) {
    if (!validAccountClaim(value)) return;
    state.accountClaim = value;
    try { localStorage.setItem(ACCOUNT_STORE, value); }
    catch (_error) { /* Private account continuity is best effort in blocked storage contexts. */ }
  }

  function mutationKey() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return `mini-ui-${globalThis.crypto.randomUUID()}`;
    }
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
      return `mini-ui-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
    }
    throw new Error("Mini Frank needs secure browser randomness.");
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ""), location.origin);
      const sameOrigin = url.origin === location.origin;
      if (!sameOrigin) return "";
      if (url.username || url.password) return "";
      return url.href;
    } catch (_error) {
      return "";
    }
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || ""), location.origin);
      if (url.protocol !== "https:" || url.username || url.password) return "";
      return url.href;
    } catch (_error) {
      return "";
    }
  }

  function cleanFiles(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 30).map((item) => ({
      id: cleanText(item && item.id, 180),
      name: cleanText(item && item.name, 240) || "Attached file",
      type: cleanText(item && item.type, 120) || "application/octet-stream",
      size: Math.max(0, Number(item && item.size) || 0),
      status: "ready",
    })).filter((item) => item.id || item.name);
  }

  function cleanTranscript(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(-MAX_SAVED_MESSAGES).map((item) => ({
      role: item && item.role === "assistant" ? "assistant" : "user",
      text: cleanText(item && item.text),
      files: cleanFiles(item && item.files).map(({ name, type, size }) => ({ name, type, size })),
    })).filter((item) => item.text || item.files.length);
  }

  function conversationPayload() {
    return state.transcript.map((item) => ({ role: item.role, text: item.text })).filter((item) => item.text);
  }

  function projects() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PROJECT_STORE) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => item && validId(item.id) && validClaim(item.claim)).map((item) => {
        const { return_event: _storedReturnEvent, ...project } = item;
        const baseline = cleanText(item.last_opened_stage, 80)
          ? {
            last_opened_stage: cleanText(item.last_opened_stage, 80),
            last_opened_had_result: Boolean(item.last_opened_had_result),
          }
          : {};
        return {
          ...project,
          ...baseline,
          transcript: cleanTranscript(item.transcript),
        };
      });
    } catch (_error) {
      return [];
    }
  }

  function saveProject(job, claim, transcriptOverride = null, options = {}) {
    if (!job || !validId(job.id) || !validClaim(claim)) return false;
    const prior = projects().find((item) => item.id === job.id);
    const list = projects().filter((item) => item.id !== job.id);
    const openedBaseline = options.recordOpened
      ? {
        last_opened_stage: cleanText(job.stage, 80) || "saved",
        last_opened_had_result: Boolean(job.result),
      }
      : (prior && prior.last_opened_stage
        ? {
          last_opened_stage: cleanText(prior.last_opened_stage, 80),
          last_opened_had_result: Boolean(prior.last_opened_had_result),
        }
        : {});
    list.unshift({
      id: job.id,
      claim,
      title: job.title || (job.result && job.result.title) || "Your solution",
      problem: job.problem || state.problem || "Private project",
      stage: job.stage || "saved",
      created_at: job.created_at,
      updated_at: job.updated_at,
      available_until: job.available_until,
      next_action: jobNextAction(job),
      refresh_status: "live",
      refresh_error: "",
      ...openedBaseline,
      transcript: Array.isArray(transcriptOverride)
        ? cleanTranscript(transcriptOverride)
        : state.transcript.length ? cleanTranscript(state.transcript) : cleanTranscript(prior && prior.transcript),
    });
    try {
      localStorage.setItem(PROJECT_STORE, JSON.stringify(list.slice(0, 50)));
      return true;
    } catch (_error) {
      notify("This browser could not add the private link to Your work.");
      return false;
    }
  }

  function forgetProject(id) {
    try { localStorage.setItem(PROJECT_STORE, JSON.stringify(projects().filter((item) => item.id !== id))); }
    catch (_error) { /* Keep the stale local entry rather than affecting anything else. */ }
  }

  function saveDraft() {
    if (!state.intake || !validId(state.intake.id) || !validClaim(state.intake.claim) || state.current) return;
    const value = {
      intake: { id: state.intake.id, claim: state.intake.claim },
      phase: state.phase,
      problem: state.problem,
      userTurns: state.userTurns,
      refining: state.refining,
      attachments: state.attachments.filter((item) => item.status === "ready").map(({ id, name, type, size }) => ({ id, name, type, size })),
      transcript: cleanTranscript(state.transcript),
    };
    try { localStorage.setItem(DRAFT_STORE, JSON.stringify(value)); }
    catch (_error) { /* The visible conversation remains available in this browser session. */ }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_STORE); }
    catch (_error) { /* Nothing user-facing depends on this cleanup. */ }
  }

  function restoredDraft() {
    try {
      const value = JSON.parse(localStorage.getItem(DRAFT_STORE) || "null");
      if (!value || !validId(value.intake && value.intake.id) || !validClaim(value.intake && value.intake.claim)) return null;
      const legacyStartPhase = ["email", "delivery"].includes(value.phase);
      const transcript = cleanTranscript(value.transcript).filter((item) => !(legacyStartPhase && item.role === "user" && (/^\S+@\S+\.\S+$/.test(item.text) || /^start building\.$/i.test(item.text))));
      while (legacyStartPhase && transcript.length && transcript[transcript.length - 1].role === "assistant" && /(where should i send|private link when it’s ready|start your free solution)/i.test(transcript[transcript.length - 1].text)) transcript.pop();
      return {
        intake: { id: value.intake.id, claim: value.intake.claim },
        phase: legacyStartPhase ? "decision" : ["problem", "guiding", "decision"].includes(value.phase) ? value.phase : "guiding",
        problem: cleanText(value.problem),
        userTurns: Math.max(0, Math.min(20, Number(value.userTurns) || 0)),
        refining: Boolean(value.refining),
        attachments: cleanFiles(value.attachments),
        transcript,
      };
    } catch (_error) {
      return null;
    }
  }

  function intakeFrom(body, claimFallback = "") {
    const item = body && body.intake && typeof body.intake === "object" ? body.intake : body || {};
    const claim = cleanText(body && (body.claim_token || body.claim), 300) || claimFallback;
    if (!validId(item.id) || !validClaim(claim)) throw new Error("Couldn’t start that conversation.");
    return {
      id: item.id,
      claim,
      status: item.status || "draft",
      attachments: cleanFiles(item.attachments),
    };
  }

  function updateIntake(body) {
    if (!state.intake || !body || !body.intake) return;
    state.intake = intakeFrom(body, state.intake.claim);
  }

  // A submitted intake is no longer a draft.  The server only includes this
  // short-lived private access when the intake bearer was accepted, so never
  // infer a job from any other response field or from browser storage.
  function linkedJobAccess(body) {
    const linked = body && body.linked_job;
    if (!linked || typeof linked !== "object") return null;
    const id = cleanText(linked.job_id, 180);
    const claim = cleanText(linked.claim_token, 300);
    return validId(id) && validClaim(claim) ? { id, claim } : null;
  }

  function recoverSubmittedIntake() {
    clearDraft();
    // Do not abandon the submitted intake: it may already have created work.
    // This merely discards the unusable local draft and starts a distinct one.
    newConversation(false);
    addMessage("assistant", "Your previous free project was already sent. I couldn’t safely reopen it from this browser, so I cleared that old draft. Tell me the next problem you want solved and I’ll start a new free project.", { record: false });
  }

  async function ensureIntake() {
    if (state.intake) return state.intake;
    if (intakePromise) return intakePromise;
    const generation = state.generation;
    const pending = (async () => {
      const body = await api.createIntake(conversationPayload(), { accountClaim: state.accountClaim });
      rememberAccountClaim(cleanText(body && body.account_claim_token, 300));
      const intake = intakeFrom(body);
      if (generation !== state.generation) {
        api.abandonIntake(intake).catch(() => {});
        const error = new Error("That conversation was replaced by a newer one.");
        error.name = "AbortError";
        throw error;
      }
      state.intake = intake;
      setDraftDeleteVisibility();
      saveDraft();
      return intake;
    })();
    intakePromise = pending;
    try {
      return await pending;
    } finally {
      if (intakePromise === pending) intakePromise = null;
    }
  }

  function notify(message) {
    clearTimeout(notify.timer);
    toast.textContent = message;
    toast.hidden = false;
    notify.timer = setTimeout(() => { toast.hidden = true; }, 4600);
  }

  function showDialog(dialog, trigger = document.activeElement) {
    if (!dialog || dialog.open) return;
    if (trigger instanceof HTMLElement) state.dialogTriggers.set(dialog, trigger);
    dialog.showModal();
  }

  function closeDialog(dialog) {
    if (!dialog || !dialog.open) return;
    dialog.close();
    const trigger = state.dialogTriggers.get(dialog);
    state.dialogTriggers.delete(dialog);
    if (trigger && trigger.isConnected) window.requestAnimationFrame(() => trigger.focus());
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
    } catch (_error) {
      const field = document.createElement("textarea");
      field.value = value;
      field.setAttribute("readonly", "");
      field.className = "clipboard-proxy";
      document.body.append(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
  }

  function setBusy(value) {
    state.busy = Boolean(value);
    conversation.setAttribute("aria-busy", String(state.busy));
    brandMark.classList.toggle("is-working", state.busy);
    updateSendButton();
  }

  function setDraftDeleteVisibility() {
    if (draftDeleteButton) draftDeleteButton.hidden = !(state.intake && !state.current);
  }

  function cancelMutation() {
    if (!mutationController) return;
    mutationAbortReason = "user";
    mutationController.abort();
  }

  function stopResponse() {
    if (guideController) {
      guideAbortReason = "user";
      guideController.abort();
    }
    if (mutationController) {
      mutationAbortReason = "user";
      mutationController.abort();
    }
  }

  function nearBottom() {
    return thread.scrollHeight - thread.scrollTop - thread.clientHeight < 170;
  }

  function streamAtEnd() {
    return thread.scrollHeight - thread.scrollTop - thread.clientHeight <= STREAM_END_TOLERANCE_PX;
  }

  function cancelThreadScrollFrame() {
    if (state.threadScrollFrame === null) return;
    cancelAnimationFrame(state.threadScrollFrame);
    state.threadScrollFrame = null;
  }

  function stopThreadMotion() {
    cancelThreadScrollFrame();
    // The thread's default scroll behavior is instant, so this also stops a
    // previously-started generic smooth scroll before quiet reply delivery begins.
    thread.scrollTo({ top: thread.scrollTop, behavior: "auto" });
  }

  function scrollStreamToEnd() {
    cancelThreadScrollFrame();
    thread.scrollTo({ top: thread.scrollHeight, behavior: "auto" });
  }

  function cancelStreamFrame() {
    if (state.streamFrame === null) return;
    cancelAnimationFrame(state.streamFrame);
    state.streamFrame = null;
  }

  function clearReplyAnnouncement() {
    if (state.replyAnnouncementFrame !== null) cancelAnimationFrame(state.replyAnnouncementFrame);
    state.replyAnnouncementFrame = null;
    replyAnnouncement.textContent = "";
  }

  function setReplyAnnouncement(message) {
    clearReplyAnnouncement();
    if (!message) return;
    const generation = state.generation;
    state.replyAnnouncementFrame = requestAnimationFrame(() => {
      state.replyAnnouncementFrame = null;
      if (generation === state.generation) replyAnnouncement.textContent = message;
    });
  }

  function setLatestPending(value) {
    state.newReplyPending = ENABLE_QUIET_STREAM_DELIVERY && Boolean(value);
    jumpToLatestButton.hidden = !(state.newReplyPending || document.activeElement === jumpToLatestButton);
  }

  function jumpToLatest() {
    if (!ENABLE_QUIET_STREAM_DELIVERY) return;
    scrollStreamToEnd();
    state.followingLatest = true;
    setLatestPending(false);
  }

  function scrollToEnd(force = false) {
    if (!force && !nearBottom()) return;
    cancelThreadScrollFrame();
    state.threadScrollFrame = requestAnimationFrame(() => {
      state.threadScrollFrame = null;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      endMarker.scrollIntoView({ block: "end", behavior: reduce ? "auto" : "smooth" });
    });
  }

  function hideWelcome() {
    welcome.hidden = true;
    solutionStarters.hidden = true;
    document.body.classList.add("is-conversation-active");
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  function fileKind(file) {
    const type = String(file.type || "").toLowerCase();
    const extension = String(file.name || "").split(".").pop();
    if (type.startsWith("image/")) return "IMG";
    if (type === "application/pdf") return "PDF";
    return cleanText(extension, 4).toUpperCase() || "FILE";
  }

  function fileSummary(files) {
    if (!files || !files.length) return "";
    return `<div class="message-file-summary">${files.map((file) => `<span class="message-file">${fileIcon}<span>${esc(file.name)}</span></span>`).join("")}</div>`;
  }

  function addMessage(role, text, options = {}) {
    hideWelcome();
    const follow = nearBottom();
    const item = document.createElement("article");
    item.className = `message message-${role === "assistant" ? "assistant" : "user"}`;
    item.setAttribute("aria-label", role === "assistant" ? "Frank" : "You");
    const body = document.createElement("div");
    body.className = "message-body";
    body.innerHTML = `<p class="message-text">${esc(text)}</p>${fileSummary(options.files || [])}`;
    if (role === "assistant") item.append(Object.assign(document.createElement("span"), { className: "speaker-mark" }), body);
    else item.append(body);
    messages.append(item);
    if (options.record !== false) {
      state.transcript.push({ role, text: cleanText(text), files: cleanFiles(options.files || []).map(({ name, type, size }) => ({ name, type, size })) });
      state.transcript = state.transcript.slice(-MAX_SAVED_MESSAGES);
      saveDraft();
    }
    if (options.scroll !== false && (options.forceScroll || follow)) scrollToEnd(true);
    return item;
  }

  function addThinking(options = {}) {
    hideWelcome();
    const item = document.createElement("article");
    item.className = "message message-assistant";
    item.setAttribute("aria-label", "Frank is thinking");
    item.innerHTML = `<span class="speaker-mark"></span><div class="message-body"><div class="thinking"><span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="thinking-copy">Working on it…</span></div></div>`;
    messages.append(item);
    if (options.scroll !== false) scrollToEnd(true);
    return item;
  }

  function startStreamMessage() {
    stopThreadMotion();
    const item = addMessage("assistant", "", { record: false, scroll: false });
    item.querySelector(".message-text").setAttribute("aria-live", "off");
    return item;
  }

  function recordAssistant(text) {
    state.transcript.push({ role: "assistant", text: cleanText(text), files: [] });
    state.transcript = state.transcript.slice(-MAX_SAVED_MESSAGES);
    saveDraft();
  }

  function actionsFor(message, html, options = {}) {
    const body = message && message.querySelector(".message-body");
    if (!body) return null;
    const actions = document.createElement("div");
    actions.className = "message-actions";
    actions.innerHTML = html;
    body.append(actions);
    if (options.scroll !== false) scrollToEnd(options.forceScroll !== false);
    return actions;
  }

  function attachResume(message, options = {}) {
    if (!message || message.querySelector('[data-action="resume"]')) return;
    actionsFor(message, '<button class="primary-button" type="button" data-action="resume">Start build</button>', { forceScroll: false, scroll: !options.quietStream });
    if (options.quietStream && options.followAtEnd) scrollStreamToEnd();
    state.phase = "decision";
    setComposer({ placeholder: "Add a detail or file (optional)…", attachments: true });
    saveDraft();
  }

  function consumeActions(button) {
    const group = button && button.closest(".message-actions");
    if (!group) return;
    group.querySelectorAll("button").forEach((item) => { item.disabled = true; });
  }

  function renderAttachmentList() {
    attachmentList.innerHTML = state.attachments.map((item) => `<div class="attachment-chip${item.status === "uploading" ? " is-uploading" : ""}${item.status === "error" ? " is-error" : ""}">
      <span class="attachment-preview" aria-hidden="true">${esc(fileKind(item))}</span>
      <span class="attachment-info"><span class="attachment-name">${esc(item.name)}</span><span class="attachment-size">${item.status === "uploading" ? "Adding…" : item.status === "error" ? "Couldn’t add" : esc(formatBytes(item.size))}</span></span>
      <button class="attachment-remove" type="button" data-remove-file="${esc(item.localId || item.id)}" aria-label="Remove ${esc(item.name)}"${item.status === "uploading" ? " disabled" : ""}>${closeIcon}</button>
    </div>`).join("");
    updateSendButton();
  }

  function updateSendButton() {
    const usableFiles = state.attachments.some((item) => item.status === "ready");
    const waitingFiles = state.attachments.some((item) => item.status === "uploading");
    const hasText = Boolean(messageInput.value.trim());
    const acceptsFiles = ["problem", "guiding", "decision"].includes(state.phase) || (state.phase === "ready" && jobAttachmentsAvailable());
    const canStop = Boolean(state.busy && (guideController || mutationController));
    sendButton.type = canStop ? "button" : "submit";
    sendButton.classList.toggle("is-stop", canStop);
    sendButton.setAttribute("aria-label", canStop ? "Stop response" : "Send message");
    sendButton.title = canStop ? "Stop response" : "Send message";
    sendButton.innerHTML = canStop ? stopIcon : sendIcon;
    sendButton.dataset.action = canStop ? "stop-response" : "send-message";
    sendButton.disabled = canStop ? false : state.busy || messageInput.disabled || waitingFiles || (!hasText && !(acceptsFiles && usableFiles));
  }

  function resizeComposer() {
    updateSendButton();
  }

  function setComposer(options = {}) {
    const locked = Boolean(options.locked);
    const attachments = options.attachments !== false && !locked;
    messageInput.disabled = locked;
    messageInput.placeholder = options.placeholder || (locked ? "" : "Tell me what’s not working…");
    messageInput.setAttribute("inputmode", options.inputmode || "text");
    messageInput.setAttribute("autocomplete", options.autocomplete || "off");
    messageInput.maxLength = options.maxlength || (state.phase === "ready" ? CHANGE_MAX_LENGTH : MESSAGE_MAX_LENGTH);
    attachButton.hidden = !attachments;
    fileInput.disabled = !attachments;
    composer.classList.toggle("is-locked", locked);
    if (!locked && messageInput.maxLength === CHANGE_MAX_LENGTH) showChangeLimit();
    else if (composerStatus.dataset.composerLimit === "change") clearComposerRecovery();
    updateSendButton();
  }

  function showChangeLimit() {
    composerStatus.textContent = "Free changes can be up to 2,000 characters.";
    composerStatus.hidden = false;
    composerStatus.dataset.composerLimit = "change";
    messageInput.removeAttribute("aria-invalid");
  }

  function clearComposerRecovery() {
    composerStatus.textContent = "";
    composerStatus.hidden = true;
    delete composerStatus.dataset.composerLimit;
    messageInput.removeAttribute("aria-invalid");
  }

  function setComposerRecovery(message, { invalid = false, focus = false } = {}) {
    composerStatus.textContent = message;
    composerStatus.hidden = false;
    delete composerStatus.dataset.composerLimit;
    if (invalid) messageInput.setAttribute("aria-invalid", "true");
    else messageInput.removeAttribute("aria-invalid");
    if (focus) messageInput.focus({ preventScroll: true });
  }

  function resetComposerValue() {
    messageInput.value = "";
    clearComposerRecovery();
    resizeComposer();
  }

  function jobAttachmentsAvailable() {
    const job = state.current && state.current.job;
    return Boolean(state.config.job_attachments || state.config.job_attachment_uploads || state.config.change_attachments || (job && (job.attachment_uploads_available || job.accepts_attachments || job.can_upload_attachments || job.change_attachments_available)));
  }

  function jobAttachmentsFrom(body) {
    if (body && body.job && Array.isArray(body.job.pending_change_attachments)) return cleanFiles(body.job.pending_change_attachments);
    if (body && body.job && Array.isArray(body.job.attachments)) return cleanFiles(body.job.attachments);
    if (body && Array.isArray(body.pending_change_attachments)) return cleanFiles(body.pending_change_attachments);
    if (body && Array.isArray(body.attachments)) return cleanFiles(body.attachments);
    return [];
  }

  function stageFiles(fileValues) {
    const files = Array.from(fileValues || []).filter((file) => file && typeof file.name === "string");
    if (!files.length) return;
    fileInput.value = "";
    if (state.busy) {
      return;
    }
    if (state.current && !jobAttachmentsAvailable()) {
      notify("Files can’t be added to this change yet. Tell me the change in a message.");
      return;
    }
    const limits = { ...DEFAULT_LIMITS, ...(state.config.attachments || {}) };
    const readyCount = state.attachments.filter((item) => item.status !== "error").length;
    if (readyCount + files.length > Number(limits.max_count || DEFAULT_LIMITS.max_count)) {
      notify(`You can add up to ${Number(limits.max_count || DEFAULT_LIMITS.max_count)} files.`);
      return;
    }
    const tooLarge = files.find((file) => file.size > Number(limits.max_file_bytes || DEFAULT_LIMITS.max_file_bytes));
    if (tooLarge) {
      notify(`${tooLarge.name} is too large. Keep each file under ${formatBytes(limits.max_file_bytes)}.`);
      return;
    }
    const currentBytes = state.attachments.reduce((total, item) => total + (Number(item.size) || 0), 0);
    const newBytes = files.reduce((total, file) => total + file.size, 0);
    if (currentBytes + newBytes > Number(limits.max_total_bytes || DEFAULT_LIMITS.max_total_bytes)) {
      notify(`Those files are too large together. Keep the total under ${formatBytes(limits.max_total_bytes)}.`);
      return;
    }

    const batch = files.map((file, index) => ({
      localId: `local-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      status: "uploading",
    }));
    state.attachments.push(...batch);
    renderAttachmentList();
    const generation = state.generation;
    const jobAccess = state.current && jobAttachmentsAvailable()
      ? { id: state.current.id, claim: state.current.claim }
      : null;
    uploadChain = uploadChain.catch(() => {}).then(async () => {
      if (generation !== state.generation) return;
      let priorAttachments = [];
      let target = jobAccess;
      try {
        if (target) {
          priorAttachments = [
            ...jobAttachmentsFrom({ job: state.current && state.current.job }),
            ...cleanFiles(state.attachments.filter((item) => item.status === "ready" && !batch.includes(item))),
          ];
        } else {
          target = await ensureIntake();
          if (generation !== state.generation) return;
          priorAttachments = cleanFiles(target.attachments);
        }
        const beforeIds = new Set(priorAttachments.map((item) => item.id));
      const body = jobAccess ? await api.uploadJob(target, files) : await api.uploadIntake(target, files);
        if (generation !== state.generation) return;
        let savedAttachments;
        if (jobAccess) {
          if (!state.current || state.current.id !== jobAccess.id || state.current.claim !== jobAccess.claim) return;
          if (body.job) state.current.job = body.job;
          savedAttachments = jobAttachmentsFrom(body);
        } else {
          updateIntake(body);
          savedAttachments = cleanFiles(state.intake && state.intake.attachments);
        }
        const added = savedAttachments.filter((item) => !beforeIds.has(item.id));
        batch.forEach((item, index) => {
          const saved = added[index] || savedAttachments.find((candidate) => candidate.name === item.name && candidate.size === item.size && !state.attachments.some((existing) => existing !== item && existing.id === candidate.id));
          if (saved) Object.assign(item, saved, { status: "ready", file: undefined });
          else item.status = "error";
        });
        renderAttachmentList();
        if (!jobAccess) saveDraft();
        if (batch.some((item) => item.status === "error")) notify("One file could not be added. Remove it to continue.");
      } catch (error) {
        if (generation !== state.generation) return;
        batch.forEach((item) => { item.status = "error"; item.file = undefined; });
        renderAttachmentList();
        notify(error.message || "Those files could not be added. Your message is still here.");
      }
    });
  }

  async function removeFile(key) {
    const item = state.attachments.find((file) => (file.localId || file.id) === key);
    if (!item || item.status === "uploading") return;
    const generation = state.generation;
    const jobAccess = state.current && jobAttachmentsAvailable()
      ? { id: state.current.id, claim: state.current.claim }
      : null;
    const intakeAccess = state.intake ? { id: state.intake.id, claim: state.intake.claim } : null;
    if (item.id && (state.intake || (state.current && jobAttachmentsAvailable()))) {
      item.status = "uploading";
      renderAttachmentList();
      try {
        if (jobAccess) {
          const body = await api.removeJobAttachment(jobAccess, item.id);
          if (generation !== state.generation || !state.current || state.current.id !== jobAccess.id || state.current.claim !== jobAccess.claim) return;
          if (body.job) state.current.job = body.job;
        } else {
          const body = await api.removeIntakeAttachment(intakeAccess, item.id);
          if (generation !== state.generation || !state.intake || state.intake.id !== intakeAccess.id || state.intake.claim !== intakeAccess.claim) return;
          updateIntake(body);
        }
      } catch (error) {
        if (generation !== state.generation) return;
        item.status = "ready";
        renderAttachmentList();
        notify(error.message || "Couldn’t remove that file.");
        return;
      }
    }
    if (generation !== state.generation) return;
    state.attachments = state.attachments.filter((file) => file !== item);
    renderAttachmentList();
    saveDraft();
  }

  function extractReply(body) {
    const source = body && body.reply && typeof body.reply === "object" ? body.reply : body || {};
    return cleanText(
      typeof body === "string" ? body :
        source.text || source.content || source.message || source.reply || source.assistant_message || source.next_question || "",
      12000,
    );
  }

  async function sendGuideTurn(text, onUpdate, signal, onActivity) {
    const intake = await ensureIntake();
    onActivity();
    const response = await fetch(`/api/mini/intakes/${encodeURIComponent(intake.id)}/chat`, {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "text/event-stream, application/json",
        "Content-Type": "application/json",
        "X-Mini-Claim": intake.claim,
        Authorization: `Bearer ${intake.claim}`,
        "Idempotency-Key": `mini-guide-${intake.id}-${Date.now()}`,
      },
      body: JSON.stringify({ text }),
      signal,
    });
    onActivity();
    if (!response.ok) {
      let body = {};
      try { body = await response.json(); } catch (_error) { body = {}; }
      const error = new Error(cleanText(body.error, 500) || "The guide is taking a moment.");
      error.status = response.status;
      throw error;
    }
    const contentType = String(response.headers.get("content-type") || "");
    if (contentType.includes("application/json")) return extractReply(await response.json());
    if (!response.body) return "";

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    let completed = false;
    const apply = (block) => {
      const item = parseSseBlock(block);
      if (!item) return;
      const piece = streamPiece(item.event, item.data);
      if (isAssistantCompleted(item.event, item.data)) completed = true;
      if (!piece.text) return;
      if (piece.mode === "append") answer += piece.text;
      else if (!answer || piece.text.length >= answer.length) answer = piece.text;
      onUpdate(cleanText(answer, 12000));
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      onActivity();
      buffer += decoder.decode(value, { stream: true });
      let match = /\r?\n\r?\n/.exec(buffer);
      while (match) {
        apply(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        match = /\r?\n\r?\n/.exec(buffer);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) apply(buffer);
    if (answer && !completed) throw new Error("The reply ended before it was complete.");
    return cleanText(answer, 12000);
  }

  async function guideAfter(text, files) {
    const generation = state.generation;
    setBusy(true);
    const thinking = addThinking();
    let streamMessage = null;
    let pendingStreamText = "";
    let reply = "";
    let failure = null;
    const controller = new AbortController();
    guideController = controller;
    guideAbortReason = "";
    let idleTimer = null;
    const touch = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (guideController === controller) {
          thinking.classList.add("is-slow");
          const thinkingCopy = thinking.querySelector(".thinking-copy");
          if (thinkingCopy) thinkingCopy.textContent = "Still working…";
        }
      }, GUIDE_IDLE_TIMEOUT_MS);
    };

    const paintStreamText = (value, followAtStart = false) => {
      if (!streamMessage || generation !== state.generation) return;
      const textNode = streamMessage.querySelector(".message-text");
      if (!textNode) return;
      if (!ENABLE_QUIET_STREAM_DELIVERY) {
        textNode.textContent = value;
        scrollToEnd();
        return;
      }
      const follow = followAtStart || (state.followingLatest && streamAtEnd());
      textNode.textContent = value;
      if (follow) {
        scrollStreamToEnd();
        state.followingLatest = true;
        setLatestPending(false);
      } else {
        state.followingLatest = false;
        setLatestPending(true);
      }
    };

    const flushStreamText = () => {
      state.streamFrame = null;
      const next = pendingStreamText;
      pendingStreamText = "";
      if (next) paintStreamText(next);
    };

    const queueStreamText = (partial) => {
      if (generation !== state.generation || !partial) return;
      thinking.remove();
      if (!streamMessage) {
        const followAtStart = streamAtEnd();
        streamMessage = startStreamMessage();
        state.followingLatest = followAtStart;
        paintStreamText(partial, followAtStart);
        return;
      }
      if (!ENABLE_QUIET_STREAM_DELIVERY) {
        paintStreamText(partial);
        return;
      }
      pendingStreamText = partial;
      if (state.streamFrame === null) state.streamFrame = requestAnimationFrame(flushStreamText);
    };

    updateSendButton();
    touch();
    try {
      reply = await sendGuideTurn(text, queueStreamText, controller.signal, touch);
    } catch (error) {
      failure = error;
      reply = "";
    } finally {
      clearTimeout(idleTimer);
      if (guideController === controller) guideController = null;
    }
    if (generation !== state.generation) return;
    cancelStreamFrame();
    pendingStreamText = "";
    thinking.remove();
    if (!reply) {
      if (streamMessage) streamMessage.remove();
      const recoveryMessage = guideAbortReason === "user"
        ? "Stopped waiting. Your message and files are still in this conversation. I won’t send them again automatically."
        : `${cleanText(failure && failure.message, 180) || "I couldn’t confirm a reply just now."} Your message and files are still in this conversation. I won’t send them again automatically.`;
      addMessage(
        "assistant",
        recoveryMessage,
        { record: false },
      );
      setReplyAnnouncement(guideAbortReason === "user"
        ? "Reply stopped. Your message and files are still here."
        : "Frank couldn’t reply just now. Your message and files are still here.");
      state.phase = "guiding";
      setComposer({ placeholder: "Add a detail or ask another question…", hint: "Your earlier message is still shown above.", attachments: true });
      setBusy(false);
      saveDraft();
      return;
    }
    let assistantMessage = streamMessage;
    if (assistantMessage) {
      paintStreamText(reply);
      const actions = assistantMessage.querySelector(".message-actions");
      if (actions) actions.remove();
    }
    else assistantMessage = addMessage("assistant", reply, { record: false });
    const finalText = assistantMessage.querySelector(".message-text");
    finalText.removeAttribute("aria-live");
    setReplyAnnouncement("Frank’s reply is ready.");
    const finalFollowAtEnd = ENABLE_QUIET_STREAM_DELIVERY && state.followingLatest && streamAtEnd();
    if (ENABLE_QUIET_STREAM_DELIVERY && !finalFollowAtEnd) setLatestPending(true);
    recordAssistant(reply);
    attachResume(assistantMessage, { quietStream: ENABLE_QUIET_STREAM_DELIVERY, followAtEnd: finalFollowAtEnd });
    setBusy(false);
    saveDraft();
  }

  async function submitProblemOrAnswer() {
    if (state.busy) return;
    const text = cleanText(messageInput.value);
    const files = state.attachments.filter((item) => item.status === "ready");
    if (!text && !files.length) return;
    if (text && text.length < 10) {
      setComposerRecovery(`Add ${10 - text.length} more character${10 - text.length === 1 ? "" : "s"} so Frank has enough to work from.`, { invalid: true, focus: true });
      return;
    }
    setBusy(true);
    try {
      await ensureIntake();
    } catch (error) {
      setBusy(false);
      if (error.name !== "AbortError") {
        setComposerRecovery(text
          ? "I couldn’t start a new conversation just now. Your message is still in the box. Try sending again."
          : "I couldn’t start a new conversation just now. Try sending again.");
      }
      return;
    }
    clearComposerRecovery();
    const spokenText = text || (files.length === 1 ? "I need help with this file." : "I need help with these files.");
    addMessage("user", spokenText, { files, forceScroll: true });
    setReplyAnnouncement("Message sent. Frank is replying.");
    if (!state.problem) state.problem = spokenText;
    state.userTurns += 1;
    state.attachments = state.attachments.filter((item) => item.status !== "ready");
    renderAttachmentList();
    resetComposerValue();
    setBusy(false);
    await guideAfter(spokenText, files);
  }

  function resumeDraft(button) {
    if (state.busy) return;
    consumeActions(button);
    setComposer({ locked: true, hint: "Starting your free solution…", attachments: false });
    saveDraft();
    startFreeWork("new");
  }

  function isLegacyBuildAction(value) {
    const normalized = cleanText(value).toLowerCase().replace(/\s+/g, " ");
    return normalized === `${["build", "this", "version"].join(" ")}.` || normalized === "help me refine it.";
  }

  function intakeDraft() {
    const laterAnswers = state.transcript
      .filter((item, index) => item.role === "user" && index > 0 && !isLegacyBuildAction(item.text))
      .map((item) => item.text)
      .join(" ")
      .slice(0, 1000);
    return {
      problem: state.problem,
      outcome: laterAnswers,
      people: "",
      current_way: "",
    };
  }

  async function submitIntake(options = {}) {
    const payload = {
      ...intakeDraft(),
      conversation: conversationPayload(),
    };
    return api.submitIntake(state.intake, payload, options);
  }

  async function startFreeWork(context = "new", button = null, retryPending = false) {
    if (state.busy || (button && button.disabled)) return;
    if (context === "change" && !state.current) return;
    const retry = retryPending && pendingMutation && pendingMutation.context === context
      ? pendingMutation
      : null;
    const idempotencyKey = retry ? retry.key : mutationKey();
    pendingMutation = { context, key: idempotencyKey };
    if (context === "change") setCurrentResultRevising(true);
    if (button) consumeActions(button);
    setBusy(true);
    const generation = state.generation;
    const submittedTranscript = cleanTranscript(state.transcript);
    const changeAccess = context === "change" && state.current
      ? { id: state.current.id, claim: state.current.claim }
      : null;
    const changeAttachmentIds = state.attachments.filter((item) => item.status === "ready").map((item) => item.id);
    setComposer({ locked: true, hint: context === "change" ? "Saving your change…" : "Starting your solution…", attachments: false });
    const thinking = addThinking();
    const controller = new AbortController();
    mutationController = controller;
    mutationAbortReason = "";
    updateSendButton();
    try {
      const body = context === "change"
        ? await api.changeJob(changeAccess, state.pendingChange, changeAttachmentIds, { signal: controller.signal, idempotencyKey, baseVersion: jobVersion(state.current.job) })
        : await submitIntake({ signal: controller.signal, idempotencyKey });
      rememberAccountClaim(cleanText(body && body.account_claim_token, 300));
      if (mutationController === controller) mutationController = null;
      thinking.remove();
      const job = body.job;
      const claim = context === "change" ? changeAccess.claim : cleanText(body.claim_token, 300);
      if (!job || !validId(job.id) || !validClaim(claim)) throw new Error("Your work was accepted, but the private link was incomplete.");
      if (generation !== state.generation) {
        saveProject(job, claim, submittedTranscript);
        return;
      }
      state.current = { id: job.id, claim, job };
      state.intake = null;
      setDraftDeleteVisibility();
      state.attachments = [];
      state.pendingChange = "";
      pendingMutation = null;
      clearDraft();
      setHash(state.current, true);
      if (saveProject(job, claim)) setHash(state.current, false);
      setBusy(false);
      renderJobUpdate(job, context !== "change", { source: "start", replaceExisting: context === "change" });
    } catch (error) {
      if (generation !== state.generation) return;
      if (mutationController === controller) mutationController = null;
      thinking.remove();
      setBusy(false);
      if (context === "change") setCurrentResultRevising(false);
      const cancelled = mutationAbortReason === "user" || error.code === "cancelled";
      const copy = cancelled
        ? "I stopped waiting. Your messages and files are still shown in this conversation."
        : `${cleanText(error.message, 400) || "I couldn’t start that just yet."} I couldn’t confirm whether the build started. Your messages and files are still shown here.`;
      const reply = addMessage("assistant", copy, { record: false });
      actionsFor(reply, `<button class="primary-button" type="button" data-action="retry-mutation">${context === "change" ? "Retry" : "Try build again"}</button>`);
      state.phase = context === "change" ? "ready" : "decision";
      setComposer(context === "change" ? { placeholder: "Tell me what you want changed…", hint: "Plain words are perfect.", attachments: jobAttachmentsAvailable() } : { locked: true, hint: "Review the conversation, then try again when you are ready.", attachments: false });
    }
  }

  function accessFromHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const id = params.get("project");
    const claim = params.get("key");
    if (!validId(id)) return null;
    if (validClaim(claim)) return { id, claim };
    const saved = projects().find((item) => item.id === id);
    return saved ? { id, claim: saved.claim } : null;
  }

  function publicAccessFromHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const token = cleanText(params.get("share"), 120);
    if (/^ms1_[A-Za-z0-9_-]{20,100}$/.test(token)) return { kind: "share", token };
    const published = cleanText(params.get("published"), 120);
    if (validId(published)) return { kind: "published", id: published };
    return null;
  }

  function setHash(access, includeKey = false) {
    const values = { project: access.id };
    if (includeKey) values.key = access.claim;
    history.replaceState(null, "", `#${new URLSearchParams(values)}`);
  }

  function privateLink(access) {
    const url = new URL("/mini-frank/", location.origin);
    url.hash = new URLSearchParams({ project: access.id, key: access.claim }).toString();
    return url.href;
  }

  async function copyPrivateLink() {
    if (!state.current) return;
    await copyText(privateLink(state.current));
    notify("Private link copied. Keep it somewhere safe.");
  }

  function resultArtifacts(result) {
    if (Array.isArray(result && result.artifacts)) {
      return result.artifacts.map((item) => ({
        kind: item && item.kind === "download" ? "download" : "interactive",
        label: cleanText(item && (item.label || item.title || item.name), 100) || "Your solution",
        url: safeUrl(item && (item.url || item.href || item.download_url || item.open_url)),
        mediaType: cleanText(item && item.media_type, 120),
      })).filter((item) => item.url);
    }
    const legacy = [];
    const artifactUrl = safeUrl(result && result.artifact_url);
    const sourceUrl = safeUrl(result && result.source_url);
    if (artifactUrl) legacy.push({ kind: "interactive", label: "Your solution", url: artifactUrl, mediaType: "text/html" });
    if (sourceUrl) legacy.push({ kind: "download", label: "A copy to keep", url: sourceUrl, mediaType: "application/zip" });
    return legacy;
  }

  function resultChecks(result) {
    const values = (value) => Array.isArray(value)
      ? value.map((item) => typeof item === "string" ? item : item && (item.label || item.name || item.summary)).filter(Boolean)
      : value && typeof value === "object" ? Object.entries(value).map(([name, status]) => `${name}: ${status}`) : [];
    const checkItems = values(result && result.checks);
    const limitationItems = values(result && result.limitations);
    return `<details class="result-details"><summary>Checks and limitations</summary><div class="result-detail-grid">
      <div><h4>Checks</h4>${checkItems.length ? `<ul>${checkItems.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "<p>Not supplied with this result.</p>"}</div>
      <div><h4>Limitations</h4>${limitationItems.length ? `<ul>${limitationItems.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : "<p>Not supplied with this result.</p>"}</div>
    </div></details>`;
  }

  function accessControls(job) {
    return `<button class="quiet-button" type="button" data-action="copy-link">Copy private owner link</button>${jobCanRevoke(job) ? '<button class="quiet-button danger-button" type="button" data-action="revoke-access">Revoke owner link</button>' : ""}${jobCanDelete(job) ? '<button class="quiet-button danger-button" type="button" data-action="delete-work">Delete private work</button>' : ""}`;
  }

  function jobVersion(job) {
    const value = job && (job.version ?? job.base_version ?? job.revision);
    const parsed = Number.parseInt(String(value == null ? "" : value), 10);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  function guidanceFor(job) {
    const result = job && job.result || {};
    return normalizeResultGuidance(
      job && (job.result_guidance || job.guidance) || result.guidance,
      jobVersion(job),
      job && job.self_host || result.self_host,
    );
  }

  function artifactAction(item, index, total, actionKind = "open") {
    const isDownload = item.kind === "download";
    let label = item.label;
    if (total === 1 && /^your solution$/i.test(label)) label = "solution";
    const verb = isDownload ? "Download" : "Open";
    const style = actionKind === "open" && index === 0 ? "primary-button" : "artifact-link";
    const orderClass = actionKind === "open" ? "result-action-open" : "result-action-download";
    return `<a class="${style} result-action-step ${orderClass}" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"${isDownload ? " download" : ""}>${verb} ${esc(label)}</a>`;
  }

  function artifactCard(job) {
    const result = job.result || {};
    const artifacts = resultArtifacts(result);
    const openArtifacts = artifacts.filter((item) => item.kind !== "download");
    const downloadArtifacts = artifacts.filter((item) => item.kind === "download");
    const openActions = openArtifacts.map((item, index) => artifactAction(item, index, openArtifacts.length, "open")).join("");
    const downloadActions = downloadArtifacts.map((item, index) => artifactAction(item, index, downloadArtifacts.length, "download")).join("");
    const preview = safeUrl(result.preview_url) || artifacts.find((item) => item.kind === "interactive")?.url || "";
    const detailsUrl = safeUrl(result.details_url);
    const guidance = guidanceFor(job);
    const availableUntil = Number(job.available_until) > 0
      ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" })
        .format(new Date(Number(job.available_until) * 1000))
      : "";
    return `<div class="artifact-card" id="current-result">
      <div class="artifact-top"><span class="ready-label">Ready for you</span></div>
      <div class="artifact-content">
        <h3>${esc(result.title || job.title || "Your solution")}</h3>
        <p>${esc(result.summary || "Your working result is ready.")}</p>
        ${preview ? `<div class="artifact-preview-wrap"><iframe class="artifact-preview" src="${esc(preview)}" title="Sandboxed preview of ${esc(result.title || job.title || "your result")}" sandbox loading="lazy"></iframe><p class="preview-note">This preview is static and sandboxed. Use the open or download action below for the full result.</p></div>` : ""}
        <div class="result-primary-actions">${openActions}<button class="secondary-button result-action-step result-action-change" type="button" data-action="request-change">Change it — free</button><button class="secondary-button result-action-step result-action-share" type="button" data-action="share">Share</button></div>
        <div class="result-download-actions">${downloadActions}${detailsUrl ? `<a class="artifact-link result-action-step result-action-download" href="${esc(detailsUrl)}" target="_blank" rel="noopener noreferrer">Open build notes</a>` : ""}</div>
        ${resultChecks(result)}
        ${resultGuidanceMarkup(guidance)}
        <div class="artifact-meta"><span>${availableUntil ? `Available here until ${esc(availableUntil)}` : "Availability date not provided"}</span><span>Keep this private link if you want to return to this work.</span></div>
        <details class="result-details owner-access-details"><summary>Private owner access and deletion</summary><div class="artifact-actions artifact-secondary-actions">${accessControls(job)}</div></details>
      </div>
    </div>`;
  }

  function setCurrentResultRevising(value) {
    const card = state.jobMessage && state.jobMessage.querySelector(".artifact-card");
    if (!card) return;
    card.inert = Boolean(value);
    card.classList.toggle("is-revising", Boolean(value));
    card.setAttribute("aria-busy", String(Boolean(value)));
    card.querySelectorAll("[id]").forEach((item) => {
      if (value && ["current-result", "result-guidance-title"].includes(item.id)) {
        item.dataset.restoreId = item.id;
        item.removeAttribute("id");
      } else if (!value && item.dataset.restoreId) {
        item.id = item.dataset.restoreId;
        delete item.dataset.restoreId;
      }
    });
  }

  function sharedResultCard(shared) {
    const result = shared && shared.result || {};
    const artifacts = resultArtifacts(result);
    const openArtifacts = artifacts.filter((item) => item.kind !== "download");
    const downloadArtifacts = artifacts.filter((item) => item.kind === "download");
    const openActions = openArtifacts.map((item, index) => artifactAction(item, index, openArtifacts.length, "open")).join("");
    const downloadActions = downloadArtifacts.map((item, index) => artifactAction(item, index, downloadArtifacts.length, "download")).join("");
    const share = shared && shared.share || {};
    const role = cleanText(share.role, 40) || "viewer";
    return `<div class="artifact-card shared-result-card" id="shared-result">
      <div class="artifact-top"><span class="ready-label">Shared Mini Frank work</span></div>
      <div class="artifact-content">
        <h3>${esc(result.title || shared.title || "Shared result")}</h3>
        <p>${esc(result.summary || "This result was shared with you.")}</p>
        <div class="result-primary-actions">${openActions}</div>
        <div class="result-download-actions">${downloadActions}</div>
        ${resultChecks(result)}
        <div class="owner-boundary"><strong>Your shared role is ${esc(role)}.</strong><span>Shared access can never run connected actions, approve payment, request services, or reveal the owner’s private return link.</span></div>
        <section class="shared-comments" id="shared-comments" aria-labelledby="shared-comments-title"><h3 id="shared-comments-title">Comments</h3><p class="dialog-status">Loading comments…</p></section>
      </div>
    </div>`;
  }

  function commentMarkup(comments) {
    if (!comments.length) return '<p class="share-empty">No comments yet.</p>';
    return `<div class="comment-list">${comments.map((comment) => `<article><strong>${esc(comment.author || "shared user")}</strong><span>${esc(comment.kind || "comment")}</span><p>${esc(comment.text)}</p></article>`).join("")}</div>`;
  }

  function renderSharedComments(comments = []) {
    const mount = document.getElementById("shared-comments");
    const publicShare = state.publicShare;
    if (!mount || !publicShare) return;
    const share = publicShare.shared && publicShare.shared.share || {};
    const canComment = publicShare.kind === "share" && share.can_comment === true;
    const canSuggest = canComment && share.can_suggest === true;
    mount.innerHTML = `<h3 id="shared-comments-title">Comments</h3>${commentMarkup(comments)}${canComment ? `<form class="shared-comment-form" id="shared-comment-form"><label for="shared-comment">Add a ${canSuggest ? "comment or suggestion" : "comment"}</label><textarea id="shared-comment" name="text" rows="3" maxlength="2000" required></textarea>${canSuggest ? '<label for="shared-comment-kind">Type</label><select id="shared-comment-kind" name="kind"><option value="comment">Comment</option><option value="suggestion">Suggestion</option></select>' : '<input type="hidden" name="kind" value="comment">'}<button class="secondary-button" type="submit">Post</button><p class="dialog-status" role="status" aria-live="polite"></p></form>` : '<p class="dialog-status">This shared role can view the result but cannot add comments.</p>'}`;
  }

  async function loadSharedComments() {
    const publicShare = state.publicShare;
    if (!publicShare || publicShare.kind !== "share") {
      renderSharedComments([]);
      return;
    }
    try {
      const body = await api.readSharedComments(publicShare.token);
      if (!state.publicShare || state.publicShare.token !== publicShare.token) return;
      state.publicShare.commentVersion = Number(body.version) || 0;
      state.publicShare.comments = Array.isArray(body.comments) ? body.comments : [];
      renderSharedComments(state.publicShare.comments);
    } catch (error) {
      const mount = document.getElementById("shared-comments");
      if (mount) mount.innerHTML = `<h3 id="shared-comments-title">Comments</h3><p class="dialog-status is-error">${esc(error.message || "Comments are unavailable.")}</p>`;
    }
  }

  async function submitSharedComment(form) {
    const publicShare = state.publicShare;
    if (!publicShare || publicShare.kind !== "share") return;
    const data = new FormData(form);
    const text = cleanText(data.get("text"), 2000);
    const kind = cleanText(data.get("kind"), 40) || "comment";
    if (!text) return;
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[role="status"]');
    const payload = { text, kind };
    const signature = JSON.stringify({ token: publicShare.token, baseVersion: publicShare.commentVersion, ...payload });
    const idempotencyKey = sharedCommentReplay.keyFor(signature);
    button.disabled = true;
    setDialogStatus(status, "Posting…");
    try {
      const body = await api.createSharedComment(publicShare.token, payload, { baseVersion: publicShare.commentVersion, idempotencyKey });
      sharedCommentReplay.confirm(signature);
      publicShare.commentVersion = Number(body.version) || publicShare.commentVersion + 1;
      form.reset();
      await loadSharedComments();
      notify(kind === "suggestion" ? "Suggestion added." : "Comment added.");
    } catch (error) {
      button.disabled = false;
      setDialogStatus(status, error.message || "The comment was not posted.", true);
    }
  }

  async function openPublicShare(access) {
    resetState();
    const generation = state.generation;
    state.publicShare = { ...access, commentVersion: 0, comments: [], shared: null };
    messages.replaceChildren();
    welcome.hidden = true;
    solutionStarters.hidden = true;
    composerDock.hidden = true;
    document.body.classList.add("is-conversation-active");
    hideReceipt();
    const thinking = addThinking({ scroll: false });
    try {
      const body = access.kind === "share"
        ? await api.readShared(access.token)
        : await api.readPublished(access.id);
      if (generation !== state.generation || !state.publicShare) return;
      thinking.remove();
      const shared = body && body.shared;
      if (!shared || typeof shared !== "object") throw new MiniApiError("Frank returned no shared result.");
      state.publicShare.shared = shared;
      const item = addMessage("assistant", "Shared Mini Frank result", { record: false, scroll: false });
      item.querySelector(".message-body").innerHTML = sharedResultCard(shared);
      await loadSharedComments();
      scrollToEnd(true);
    } catch (error) {
      if (generation !== state.generation) return;
      thinking.remove();
      addMessage("assistant", error.status === 404 ? "This share is unavailable or has been revoked." : "I couldn’t open this shared result just now.", { record: false });
      const item = messages.lastElementChild;
      actionsFor(item, '<button class="secondary-button" type="button" data-action="new">Start your own free project</button>');
    }
  }

  function useGuidancePrompt(button) {
    const prompt = cleanText(button && button.dataset.guidancePrompt, MESSAGE_MAX_LENGTH);
    const mode = cleanText(button && button.dataset.guidanceMode, 40);
    if (!prompt) return;
    if (mode === "service") {
      openService(button, prompt);
      return;
    }
    if (mode === "new" || mode === "project") newConversation(true);
    messageInput.value = prompt;
    resizeComposer();
    messageInput.focus();
    notify(mode === "new" || mode === "project" ? "Your related free project is ready to send." : "Your project-specific change is ready to send.");
  }

  function openSelfHostGuide(trigger) {
    if (!state.current || state.current.job.stage !== "ready") return;
    const guide = guidanceFor(state.current.job).selfHost || null;
    selfHostContent.innerHTML = selfHostGuideMarkup(guide);
    showDialog(selfHostDialog, trigger);
  }

  function currentAccess() {
    return state.current ? { id: state.current.id, claim: state.current.claim } : null;
  }

  function setDialogStatus(element, message, isError = false) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("is-error", Boolean(isError));
  }

  function tipCapability() {
    const source = state.config && (state.config.tips || state.config.tipping);
    if (!source || typeof source !== "object") return { status: "unconfigured" };
    const status = cleanText(source.status, 80) || (source.available === true ? "available" : "unavailable");
    const amountsSupported = source.accepts_client_amount === true && Array.isArray(source.amounts);
    return { status, amountsSupported, message: cleanText(source.message || source.description || source.copy, 500) };
  }

  function selectedTipAmount() {
    const selected = tipForm.querySelector('input[name="tip-amount"]:checked');
    if (!selected) return null;
    if (selected.value !== "custom") return Number(selected.value);
    const amount = Number.parseFloat(String(customTipAmount.value || "").replace(/[^0-9.]/g, ""));
    return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
  }

  function updateTipForm() {
    const selected = tipForm.querySelector('input[name="tip-amount"]:checked');
    customTip.hidden = !selected || selected.value !== "custom";
    const amount = selectedTipAmount();
    const capability = tipCapability();
    tipAmounts.hidden = !capability.amountsSupported;
    if (!capability.amountsSupported) customTip.hidden = true;
    tipSubmit.textContent = capability.amountsSupported ? "Continue to tip" : "Leave a tip";
    const ready = capability.status === "available" && (!capability.amountsSupported || amount !== null);
    tipSubmit.disabled = !ready;
    if (capability.status !== "available") {
      setDialogStatus(tipStatus, capability.message || "Tipping is not connected yet. Everything in Mini Frank remains free.");
    } else if (capability.amountsSupported && amount === null) {
      setDialogStatus(tipStatus, "Choose an amount if you would like to leave a tip.");
    } else if (capability.amountsSupported) {
      setDialogStatus(tipStatus, `A$${amount.toFixed(2)} is a voluntary tip only. It changes no access or priority.`);
    } else {
      setDialogStatus(tipStatus, "The tip page lets you choose the amount. Everything here remains free either way.");
    }
  }

  function openTip(trigger) {
    tipForm.reset();
    customTipAmount.value = "";
    updateTipForm();
    showDialog(tipDialog, trigger);
    api.tipConfig().then((tips) => {
      state.config = { ...state.config, tips: { ...(state.config.tips || {}), ...(tips || {}) } };
      updateTipForm();
    }).catch(() => {});
  }

  async function submitTip() {
    const capability = tipCapability();
    const amount = selectedTipAmount();
    if (capability.status !== "available" || (capability.amountsSupported && amount === null)) return;
    tipSubmit.disabled = true;
    setDialogStatus(tipStatus, "Preparing the voluntary tip…");
    try {
      const payload = capability.amountsSupported ? { currency: "AUD", amount } : {};
      const body = state.current
        ? await api.createJobTip(currentAccess(), payload, { idempotencyKey: mutationKey() })
        : await api.createTip(payload, { idempotencyKey: mutationKey() });
      const intent = body && body.intent || {};
      const checkoutUrl = safeExternalUrl(intent.provider_url);
      if (!checkoutUrl) throw new MiniApiError("Frank did not return a secure tip destination.");
      window.location.assign(checkoutUrl);
    } catch (error) {
      tipSubmit.disabled = false;
      setDialogStatus(tipStatus, error.message || "Tipping is unavailable right now. Everything remains free.", true);
    }
  }

  function normalizeSharing(item) {
    if (!item || typeof item !== "object") return null;
    const active = item.active_link && typeof item.active_link === "object" ? item.active_link : null;
    return {
      mode: cleanText(item.mode, 40) || "restricted",
      role: cleanText(item.role, 40) || "viewer",
      scope: cleanText(item.scope, 40) || "result",
      version: jobVersion(item),
      activeLink: active ? {
        id: cleanText(active.id, 180),
        role: cleanText(active.role, 40) || "viewer",
        scope: cleanText(active.scope, 40) || "result",
        revokedAt: Number(active.revoked_at) || 0,
        generation: Number(active.generation) || 1,
      } : null,
      publishedAt: Number(item.published_at) || 0,
      namedPeople: item.named_people && typeof item.named_people === "object" ? item.named_people : null,
    };
  }

  function shareLabel(share) {
    if (share.mode === "published") return "Published copy";
    if (share.mode === "link") return "Anyone with the link";
    return "Owner only";
  }

  function renderShares() {
    if (!state.shares.length) {
      shareList.innerHTML = '<div class="share-empty">No active shares were returned for this project.</div>';
      return;
    }
    shareList.innerHTML = state.shares.map((share) => `<article class="share-row" data-share-id="${esc(share.id)}">
      <strong>${esc(shareLabel(share))}</strong>
      <div class="share-row-actions">${share.url ? '<button class="quiet-button" type="button" data-share-action="copy">Copy link</button>' : ""}<button class="quiet-button" type="button" data-share-action="edit">Edit</button>${share.mode === "link" && share.id ? '<button class="quiet-button" type="button" data-share-action="rotate">Rotate link</button><button class="quiet-button danger-button" type="button" data-share-action="revoke">Revoke</button>' : ""}</div>
      <p>${esc(`${share.mode} · ${share.role} · ${share.scope}`)}</p>
    </article>`).join("");
  }

  function resetShareForm() {
    shareForm.reset();
    state.editingShareId = "";
    shareForm.querySelector('input[name="share-mode"][value="restricted"]').checked = true;
    sharePeopleField.hidden = false;
    shareSubmit.textContent = "Save access";
  }

  function populateShareForm(sharing) {
    if (!sharing) return;
    const active = sharing.activeLink && !sharing.activeLink.revokedAt ? sharing.activeLink : null;
    const modeValue = ["restricted", "link", "published"].includes(sharing.mode) ? sharing.mode : "restricted";
    const roleValue = active && active.role || sharing.role;
    const scopeValue = active && active.scope || sharing.scope;
    const mode = shareForm.querySelector(`input[name="share-mode"][value="${CSS.escape(modeValue)}"]`);
    if (mode) mode.checked = true;
    shareForm.elements.namedItem("share-role").value = ["viewer", "commenter", "editor"].includes(roleValue) ? roleValue : "viewer";
    // Template projection is intentionally not offered until it contains a
    // reusable artifact. Existing server state remains visible but cannot be
    // re-selected accidentally by this release.
    shareForm.elements.namedItem("share-scope").value = ["result", "project"].includes(scopeValue) ? scopeValue : "result";
    updateShareMode();
  }

  function updateShareMode() {
    const mode = shareForm.querySelector('input[name="share-mode"]:checked')?.value || "restricted";
    sharePeopleField.hidden = mode !== "restricted";
    const role = shareForm.elements.namedItem("share-role");
    if (mode === "published") {
      role.value = "viewer";
      role.disabled = true;
    } else {
      role.disabled = false;
    }
  }

  async function loadShares() {
    const access = currentAccess();
    if (!access) return;
    state.shareCapability = "loading";
    shareSubmit.disabled = true;
    setDialogStatus(shareStatus, "Loading current access…");
    try {
      const body = await api.readSharing(access);
      state.sharing = normalizeSharing(body && body.sharing);
      state.shareCapability = state.sharing ? "available" : "unconfigured";
      const current = state.sharing;
      const active = current && current.activeLink && !current.activeLink.revokedAt ? current.activeLink : null;
      const url = current && current.mode === "published"
        ? new URL(`/mini-frank/#published=${encodeURIComponent(access.id)}`, location.origin).href
        : "";
      state.shares = current ? [{
        id: active && active.id || current.mode,
        mode: current.mode,
        role: active && active.role || current.role,
        scope: active && active.scope || current.scope,
        url,
      }] : [];
      populateShareForm(current);
      renderShares();
      const available = state.shareCapability === "available" || state.shareCapability === "configured";
      shareSubmit.disabled = !available;
      setDialogStatus(shareStatus, available
        ? "Sharing is ready. Nothing changes until you save it."
        : cleanText(body && (body.message || body.reason), 300) || "Sharing is not configured for this project yet. Your work remains restricted.");
    } catch (error) {
      state.shareCapability = "unavailable";
      state.shares = [];
      renderShares();
      shareSubmit.disabled = true;
      setDialogStatus(shareStatus, error.message || "Sharing is unavailable. Your work remains restricted.", true);
    }
  }

  function openShare(trigger) {
    if (!state.current || state.current.job.stage !== "ready") return;
    resetShareForm();
    renderShares();
    showDialog(shareDialog, trigger);
    loadShares();
  }

  function sharePayload() {
    const form = new FormData(shareForm);
    const mode = cleanText(form.get("share-mode"), 40);
    return {
      mode,
      role: mode === "published" ? "viewer" : cleanText(form.get("share-role"), 40),
      scope: cleanText(form.get("share-scope"), 40),
    };
  }

  async function submitShare() {
    const access = currentAccess();
    if (!access || !["available", "configured"].includes(state.shareCapability)) return;
    const payload = sharePayload();
    shareSubmit.disabled = true;
    setDialogStatus(shareStatus, "Saving access…");
    try {
      let copiedUrl = "";
      const options = { baseVersion: state.sharing && state.sharing.version, idempotencyKey: mutationKey() };
      const activeLink = state.sharing && state.sharing.activeLink && !state.sharing.activeLink.revokedAt;
      if (payload.mode === "link" && !activeLink) {
        const created = await api.createShare(access, { role: payload.role, scope: payload.scope }, options);
        copiedUrl = safeUrl(created && created.share && created.share.url);
      } else await api.updateSharing(access, payload, options);
      resetShareForm();
      await loadShares();
      setDialogStatus(shareStatus, "Access saved. Execution and payment remain owner-only.");
      if (copiedUrl) {
        state.shares = state.shares.map((share) => share.mode === "link" ? { ...share, url: copiedUrl } : share);
        renderShares();
        await copyText(copiedUrl);
        notify("Share link copied. Only the owner can execute work or approve payment.");
      }
    } catch (error) {
      shareSubmit.disabled = false;
      setDialogStatus(shareStatus, error.message || "Access was not changed.", true);
    }
  }

  function editShare(share) {
    state.editingShareId = share.id;
    const mode = shareForm.querySelector(`input[name="share-mode"][value="${CSS.escape(share.mode)}"]`);
    if (mode) mode.checked = true;
    shareForm.elements.namedItem("share-role").value = ["viewer", "commenter", "editor"].includes(share.role) ? share.role : "viewer";
    shareForm.elements.namedItem("share-scope").value = ["result", "project"].includes(share.scope) ? share.scope : "result";
    updateShareMode();
    shareSubmit.textContent = "Save access";
    shareForm.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  async function mutateShare(share, action, button) {
    const access = currentAccess();
    if (!access) return;
    if (action === "copy" && share.url) {
      await copyText(share.url);
      notify("Share link copied.");
      return;
    }
    if (action === "edit") {
      editShare(share);
      return;
    }
    if (action === "revoke" && !window.confirm("Revoke this share? People using it will lose access.")) return;
    button.disabled = true;
    try {
      const options = { baseVersion: state.sharing && state.sharing.version, idempotencyKey: mutationKey() };
      const body = action === "rotate"
        ? await api.rotateShare(access, share.id, options)
        : await api.revokeShare(access, share.id, options);
      const rotatedUrl = safeUrl(body && body.share && body.share.url);
      await loadShares();
      if (action === "rotate" && rotatedUrl) {
        await copyText(rotatedUrl);
        notify("New share link copied. The old link no longer works.");
      } else notify("Share revoked.");
    } catch (error) {
      button.disabled = false;
      setDialogStatus(shareStatus, error.message || "Access was not changed.", true);
    }
  }

  function serviceState(job) {
    const guidance = guidanceFor(job);
    const guide = guidance.selfHost;
    const service = guide && guide.service;
    if (!service) return {
      status: "unconfigured",
      modes: ["not_now"],
      contactMethods: [],
      contactNotice: "Contact details stay private to this project.",
      handoff: "",
      message: "",
    };
    const result = job && job.result || {};
    const larger = guidance.liveImplementation;
    const handoffParts = [
      cleanText(result.title || job.title, 200),
      cleanText(result.summary, 800),
      cleanText(guide.summary, 1000),
      cleanText(service.reason, 500),
      cleanText(larger && larger.actions && larger.actions[0] && larger.actions[0].prompt, 1200),
    ].filter(Boolean);
    return {
      status: service.available === true ? "available" : "unavailable",
      message: cleanText(service.reason, 500),
      priceStatus: cleanText(service.priceStatus, 80),
      modes: ["self_host_help", "managed_hosting", "video_call", "perth_visit", "custom_project", "not_now"],
      contactMethods: ["email", "phone", "whatsapp", "other"],
      contactNotice: "Contact details are saved privately for operator review. Do not include passwords, access keys or other secrets.",
      handoff: handoffParts.join("\n\n").slice(0, SERVICE_NOTE_MAX_LENGTH),
    };
  }

  function normalizeServiceOptions(body, fallback) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return fallback;
    const knownModes = new Set(["self_host_help", "managed_hosting", "video_call", "perth_visit", "custom_project"]);
    const modes = Array.isArray(body.options) ? body.options.map((item) => {
      if (!item || typeof item !== "object") return "";
      const kind = cleanText(item.kind, 40);
      const status = cleanText(item.status, 80);
      return knownModes.has(kind) && ["available", "available_after_owner_review"].includes(status) ? kind : "";
    }).filter(Boolean) : [];
    const knownContactMethods = new Set(["email", "phone", "whatsapp", "other"]);
    const contact = body.contact && typeof body.contact === "object" ? body.contact : {};
    const contactMethods = Array.isArray(contact.methods)
      ? contact.methods.map((item) => cleanText(item, 40)).filter((item) => knownContactMethods.has(item))
      : [];
    const status = cleanText(body.status, 80);
    return {
      ...fallback,
      status: status === "available" && modes.length ? "available" : "unavailable",
      message: cleanText(body.message, 500) || fallback.message,
      priceStatus: cleanText(body.price_status, 80) || fallback.priceStatus,
      modes: [...modes, "not_now"],
      contactMethods,
      contactNotice: cleanText(contact.notice, 500) || fallback.contactNotice,
    };
  }

  function applyServiceOptions(options, handoffOverride = "") {
    state.serviceOptions = options;
    state.serviceCapability = options.status;
    serviceHandoff.value = cleanText(handoffOverride, SERVICE_NOTE_MAX_LENGTH) || options.handoff;
    serviceForm.querySelectorAll('input[name="service-mode"]').forEach((input) => {
      input.disabled = !options.modes.includes(input.value);
    });
    serviceContactMethod.querySelectorAll("option").forEach((option) => {
      option.disabled = Boolean(option.value) && !options.contactMethods.includes(option.value);
    });
    serviceContactNotice.textContent = options.contactNotice || "Contact details are saved privately for operator review. Do not include secrets.";
    const available = state.serviceCapability === "available";
    const pricing = options.priceStatus === "scope_required"
      ? " Any price requires a reviewed scope first."
      : "";
    setDialogStatus(serviceStatus, available
      ? `${options.message || "Review the handoff, then save it only if you want hands-on help."}${pricing}`
      : options.message || "Hands-on service is not configured for this result. The free guide remains available.");
    updateServiceForm();
  }

  function updateServiceForm() {
    const selected = serviceForm.querySelector('input[name="service-mode"]:checked')?.value || "";
    const available = ["available", "configured"].includes(state.serviceCapability);
    const contactMethod = cleanText(serviceContactMethod.value, 40);
    const contactValue = cleanText(serviceContactValue.value, 200);
    serviceSubmit.disabled = !selected || selected === "not_now" || !available || !contactMethod || !contactValue || !cleanText(serviceHandoff.value, SERVICE_NOTE_MAX_LENGTH);
  }

  async function loadServiceOptions(handoffOverride = "") {
    const access = currentAccess();
    if (!access) return;
    const fallback = serviceState(state.current && state.current.job);
    applyServiceOptions(fallback, handoffOverride);
    try {
      const body = await api.readServiceOptions(access);
      if (access.id !== state.current?.id || !serviceDialog.open) return;
      applyServiceOptions(normalizeServiceOptions(body, fallback), handoffOverride);
    } catch (_error) {
      if (fallback.status !== "available") applyServiceOptions(fallback, handoffOverride);
    }
  }

  function openService(trigger, handoffOverride = "") {
    if (!state.current) return;
    const returnTrigger = selfHostDialog.open
      ? state.dialogTriggers.get(selfHostDialog) || trigger
      : trigger;
    if (selfHostDialog.open) {
      selfHostDialog.close();
      state.dialogTriggers.delete(selfHostDialog);
    }
    serviceForm.querySelectorAll("input, textarea, select").forEach((field) => { field.disabled = false; });
    serviceForm.reset();
    state.serviceOptions = null;
    showDialog(serviceDialog, returnTrigger);
    loadServiceOptions(handoffOverride);
  }

  async function submitServiceHandoff() {
    const access = currentAccess();
    const mode = serviceForm.querySelector('input[name="service-mode"]:checked')?.value || "";
    if (mode === "not_now") {
      closeDialog(serviceDialog);
      return;
    }
    if (!access || !["available", "configured"].includes(state.serviceCapability)) return;
    const handoff = cleanText(serviceHandoff.value, SERVICE_NOTE_MAX_LENGTH);
    const contactMethod = cleanText(serviceContactMethod.value, 40);
    const contactValue = cleanText(serviceContactValue.value, 200);
    if (!handoff || !["email", "phone", "whatsapp", "other"].includes(contactMethod) || !contactValue) return;
    serviceSubmit.disabled = true;
    setDialogStatus(serviceStatus, "Saving the reviewed request…");
    const payload = {
      kind: mode,
      owner_reviewed: true,
      note: handoff,
      contact: { method: contactMethod, value: contactValue },
    };
    const signature = JSON.stringify({ job: access.id, ...payload });
    const idempotencyKey = serviceRequestReplay.keyFor(signature);
    try {
      const body = await api.createServiceRequest(access, payload, { idempotencyKey });
      serviceRequestReplay.confirm(signature);
      const request = body && body.request || {};
      const status = cleanText(request.status, 100);
      const notified = body && body.notification_sent === true;
      const started = body && body.execution_started === true;
      setDialogStatus(serviceStatus, status === "saved_for_review"
        ? `Saved for review. ${notified ? "Frank has been notified." : "Frank hasn’t contacted you yet."} ${started ? "The response says implementation has started." : "No payment or implementation has been approved or started."}`
        : "Your request is saved with this project. Nothing starts automatically and no payment was approved.");
      serviceForm.querySelectorAll("input, textarea, select").forEach((field) => { field.disabled = true; });
    } catch (error) {
      serviceSubmit.disabled = false;
      setDialogStatus(serviceStatus, error.message || "The request was not sent.", true);
    }
  }

  function makeAnother() {
    const prompt = state.problem ? `${state.problem}\n\nMake another like this.` : "Make another like this.";
    newConversation(true);
    messageInput.value = prompt;
    resizeComposer();
    messageInput.focus();
    notify("I kept the original work. Add any new files before sending.");
  }

  async function deletePrivateWork(button) {
    if (!state.current || !jobCanDelete(state.current.job)) return;
    if (!window.confirm("Delete this private work? Its conversation, files, and result will be removed if the server supports deletion.")) return;
    button.disabled = true;
    const access = { id: state.current.id, claim: state.current.claim };
    try {
      await api.deleteJob(access);
      forgetProject(access.id);
      newConversation(false);
      notify("Your private work was deleted.");
    } catch (error) {
      button.disabled = false;
      notify(error.message || "I could not delete this work. Nothing was changed.");
    }
  }

  async function deleteDraft() {
    if (!state.intake || state.current) return;
    if (!window.confirm("Delete this draft and its uploaded files now?")) return;
    const access = { id: state.intake.id, claim: state.intake.claim };
    try {
      await api.abandonIntake(access);
      newConversation(false);
      notify("Your draft and uploaded files were deleted.");
    } catch (error) {
      notify(error.message || "I could not delete this draft. Nothing was changed.");
    }
  }

  async function revokeAccess(button) {
    if (!state.current || !jobCanRevoke(state.current.job)) return;
    if (!window.confirm("Revoke this private link? Anyone using the link will lose access.")) return;
    button.disabled = true;
    const access = { id: state.current.id, claim: state.current.claim };
    try {
      await api.revokeJob(access);
      forgetProject(access.id);
      newConversation(false);
      notify("Link access was revoked.");
    } catch (error) {
      button.disabled = false;
      notify(error.message || "I could not revoke this link. Nothing was changed.");
    }
  }

  const stageCopy = {
    queued: ["Waiting to start…", "The service last reported this work as waiting."],
    working: ["Working on it…", "The service last reported this work as in progress."],
    checking: ["Almost ready…", "The service last reported that it is checking this work."],
    needs_attention: ["Needs another pass", "Review the work and choose Retry if it is offered."],
    ready: ["Ready to review.", "Open the project details below."],
  };

  function statusCard(job) {
    const copy = stageCopy[job.stage] || stageCopy.queued;
    const canRetry = job.stage === "needs_attention" && Boolean(job.retry_available);
    const queuedCopy = job.stage === "queued" && job.automatic_retry_at
      ? `Next retry time reported: ${formatDateTime(job.automatic_retry_at)}.`
      : copy[1];
    const offlineCopy = navigator.onLine ? "" : " You’re offline; status checks resume when this browser is back online.";
    return `<div class="status-card" role="status">
      <span class="status-light${job.stage === "needs_attention" ? " attention" : ""}" aria-hidden="true"></span>
      <div class="status-copy"><strong>${esc(copy[0])}</strong><p>${esc(queuedCopy + offlineCopy)}</p><p class="status-retention">Keep this private link if you want to return to this work.</p>
        <div class="message-actions">${canRetry ? '<button class="secondary-button" type="button" data-action="retry">Retry</button>' : ""}${accessControls(job)}</div>
      </div>
    </div>`;
  }

  function jobMessageText(job) {
    if (job.stage === "ready") return "The service last reported this work as ready.";
    return stageCopy[job.stage]?.[0] || stageCopy.queued[0];
  }

  function jobBody(job) {
    return job.stage === "ready" && job.result ? artifactCard(job) : statusCard(job);
  }

  function renderJobUpdate(job, forceNew = false, options = {}) {
    if (!job || !state.current) return;
    const policy = jobRenderPolicy(options.source || "background");
    const sameStage = state.lastStage === job.stage;
    if ((options.replaceExisting || (!forceNew && sameStage)) && state.jobMessage && state.jobMessage.isConnected) {
      state.jobMessage.querySelector(".message-body").innerHTML = jobBody(job);
    } else {
      const item = addMessage("assistant", jobMessageText(job), { record: false, scroll: policy.scrollToEnd });
      item.querySelector(".message-body").innerHTML = jobBody(job);
      state.jobMessage = item;
      state.lastStage = job.stage;
    }
    state.current.job = job;
    state.problem = job.problem || state.problem;
    const receiptSource = options.source || "background";
    if (["work", "direct"].includes(receiptSource) || (receiptSource !== "start" && !projectReceipt.hidden)) renderReceipt(job);
    else hideReceipt();
    const locallySaved = saveProject(job, state.current.claim, null, { recordOpened: Boolean(options.recordOpened) });
    setHash(state.current, !locallySaved);
    if (job.stage === "ready" && job.result) {
      stopPolling();
      state.phase = "ready";
      setComposer({ placeholder: "Tell me what you want changed…", hint: "Plain words are perfect.", attachments: jobAttachmentsAvailable() });
    } else {
      state.phase = "job";
      setComposer({ locked: true, hint: "Keep the private link if you want to return here.", attachments: false });
      pollLater();
    }
    setBusy(false);
    if (policy.focusReceipt && projectReceiptTitle) projectReceiptTitle.focus();
    else if (policy.scrollToEnd) scrollToEnd(true);
  }

  function stopPolling() {
    clearTimeout(state.timer);
    state.timer = null;
  }

  function pollLater() {
    pollLaterWithDelay(null);
  }

  function pollLaterWithDelay(delay) {
    stopPolling();
    const generation = state.generation;
    const job = state.current && state.current.job;
    const stageDelay = job && job.stage === "checking" ? 5000 : job && job.stage === "working" ? STATUS_POLL_BASE_MS : STATUS_POLL_BASE_MS * 1.5;
    const backoff = Math.min(60000, stageDelay * (2 ** Math.min(state.pollFailures, 3)));
    const wait = delay == null
      ? (!navigator.onLine ? STATUS_POLL_OFFLINE_MS : (document.hidden ? STATUS_POLL_HIDDEN_MS : backoff))
      : delay;
    state.timer = setTimeout(async () => {
      if (generation !== state.generation || !state.current) return;
      if (!navigator.onLine) {
        pollLaterWithDelay(STATUS_POLL_OFFLINE_MS);
        return;
      }
      try {
        const body = await api.readJob(state.current);
        if (generation !== state.generation || !state.current) return;
        rememberAccountClaim(cleanText(body && body.account_claim_token, 300));
        state.pollFailures = 0;
        renderJobUpdate(body.job);
      } catch (error) {
        if (error.status === 404) {
          forgetProject(state.current.id);
          history.replaceState(null, "", location.pathname + location.search);
          newConversation(false);
          addMessage("assistant", "I couldn’t open that private link. It may be incomplete or no longer available.");
        } else {
          state.pollFailures += 1;
          pollLaterWithDelay(null);
        }
      }
    }, wait);
  }

  function refreshNetworkState() {
    if (state.current && state.current.job && state.current.job.stage !== "ready") {
      if (state.jobMessage && state.jobMessage.isConnected) state.jobMessage.querySelector(".message-body").innerHTML = jobBody(state.current.job);
      pollLaterWithDelay(navigator.onLine ? 0 : STATUS_POLL_OFFLINE_MS);
    }
  }

  function resetState() {
    stopPolling();
    cancelStreamFrame();
    cancelThreadScrollFrame();
    setLatestPending(false);
    state.followingLatest = true;
    if (guideController) guideController.abort();
    guideController = null;
    guideAbortReason = "";
    intakePromise = null;
    state.generation += 1;
    state.phase = "problem";
    state.intake = null;
    state.attachments = [];
    state.transcript = [];
    state.problem = "";
    state.pendingChange = "";
    state.userTurns = 0;
    state.refining = false;
    state.busy = false;
    state.current = null;
    state.publicShare = null;
    state.jobMessage = null;
    state.lastStage = "";
    state.pollFailures = 0;
    hideReceipt();
    mutationAbortReason = "";
    pendingMutation = null;
    sharedCommentReplay.reset();
    serviceRequestReplay.reset();
    if (mutationController) mutationController.abort();
    mutationController = null;
    setDraftDeleteVisibility();
    clearReplyAnnouncement();
  }

  function newConversation(clearStored = true) {
    const abandoned = clearStored && state.intake && !state.current
      ? { id: state.intake.id, claim: state.intake.claim }
      : null;
    resetState();
    if (abandoned) api.abandonIntake(abandoned).catch(() => {});
    if (clearStored) clearDraft();
    history.replaceState(null, "", location.pathname + location.search);
    messages.replaceChildren();
    composerDock.hidden = false;
    welcome.hidden = false;
    solutionStarters.hidden = false;
    document.body.classList.remove("is-conversation-active");
    renderAttachmentList();
    resetComposerValue();
    setComposer({ placeholder: "Tell me what’s not working…", hint: "No tech words needed.", attachments: true });
    setBusy(false);
    if (drawer.open) drawer.close();
    thread.scrollTop = 0;
  }

  function confirmDiscardDraft() {
    const hasDraft = !state.current && Boolean(
      state.intake
      || state.attachments.length
      || state.transcript.length
      || messageInput.value.trim()
    );
    return !hasDraft || window.confirm(
      "Start a new conversation? Your current draft and uploaded files will be removed."
    );
  }

  async function openProject(access, options = {}) {
    resetState();
    const generation = state.generation;
    state.current = { ...access, job: null };
    setHash(access, true);
    messages.replaceChildren();
    welcome.hidden = true;
    solutionStarters.hidden = true;
    document.body.classList.add("is-conversation-active");
    const saved = projects().find((item) => item.id === access.id);
    if (saved && saved.transcript.length) {
      state.transcript = cleanTranscript(saved.transcript);
      state.transcript.forEach((item) => addMessage(item.role, item.text, { files: item.files, record: false, scroll: false }));
      state.problem = saved.problem || "";
    } else if (saved && saved.problem && saved.problem !== "Private project") {
      state.problem = saved.problem;
      addMessage("user", saved.problem, { record: false, scroll: false });
    }
    setComposer({ locked: true, hint: "Opening your private work…", attachments: false });
    setBusy(true);
    const thinking = addThinking({ scroll: false });
    try {
      const body = await api.readJob(access);
      if (generation !== state.generation) return;
      rememberAccountClaim(cleanText(body && body.account_claim_token, 300));
      thinking.remove();
      state.current.job = body.job;
      if (Array.isArray(body.job.conversation)) {
        state.transcript = cleanTranscript(body.job.conversation);
        messages.replaceChildren();
        state.transcript.forEach((item) => addMessage(item.role, item.text, { files: item.files, record: false, scroll: false }));
      }
      state.problem = body.job.problem || state.problem;
      if (!state.transcript.some((item) => item.role === "user") && body.job.problem) {
        state.transcript = [{ role: "user", text: cleanText(body.job.problem), files: [] }];
        addMessage("user", body.job.problem, { record: false, scroll: false });
      }
      renderJobUpdate(body.job, true, {
        source: options.source || "direct",
        recordOpened: true,
      });
    } catch (error) {
      if (generation !== state.generation) return;
      thinking.remove();
      setBusy(false);
      const savedAccess = projects().find((item) => item.id === access.id);
      if (error.status === 404 && (!savedAccess || savedAccess.claim === access.claim)) forgetProject(access.id);
      history.replaceState(null, "", location.pathname + location.search);
      state.current = null;
      addMessage("assistant", error.status === 404 ? "I couldn’t open that private link. It may be incomplete or no longer available." : "I couldn’t open your work just now.");
      setComposer({ placeholder: "Start with a new problem…", hint: "Your other work has not been changed.", attachments: true });
      state.phase = "problem";
    }
  }

  async function retryJob(button) {
    if (!state.current || state.busy) return;
    const generation = state.generation;
    const access = { id: state.current.id, claim: state.current.claim };
    consumeActions(button);
    setBusy(true);
    try {
      const body = await api.retryJob(access);
      if (generation !== state.generation || !state.current || state.current.id !== access.id || state.current.claim !== access.claim) return;
      renderJobUpdate(body.job, true);
    } catch (error) {
      if (generation !== state.generation || !state.current || state.current.id !== access.id || state.current.claim !== access.claim) return;
      setBusy(false);
      notify(error.message || "I couldn’t restart it just yet. Review this work before trying again.");
      renderJobUpdate(state.current.job, true);
    }
  }

  function requestChange() {
    if (!state.current || state.current.job.stage !== "ready") return;
    state.phase = "ready";
    addMessage("assistant", "Tell me what you’d like changed. I’ll keep the parts that are already working.", { record: false, forceScroll: true });
    setComposer({ placeholder: "Tell me what you want changed…", hint: "Plain words are perfect.", attachments: jobAttachmentsAvailable() });
    messageInput.focus();
  }

  async function beginChange() {
    if (state.busy) return;
    const rawText = String(messageInput.value || "").trim();
    if (rawText.length > CHANGE_MAX_LENGTH) {
      setComposerRecovery("Keep this change to 2,000 characters or less, then send it again.", { invalid: true, focus: true });
      return;
    }
    const text = cleanText(rawText, CHANGE_MAX_LENGTH);
    const files = state.attachments.filter((item) => item.status === "ready");
    if (text.length < 5 && !files.length) {
      notify("Tell me a little more about what should change.");
      return;
    }
    state.pendingChange = text || (files.length === 1 ? "Use this file for the change." : "Use these files for the change.");
    resetComposerValue();
    addMessage("user", state.pendingChange, { files, forceScroll: true });
    addMessage("assistant", "I’ll make that change now.", { record: false });
    setComposer({ locked: true, hint: "Saving your change…", attachments: false });
    await startFreeWork("change");
  }

  async function refreshProjects() {
    const list = projects();
    if (!list.length) return list;
    const refreshed = await Promise.all(list.map(async (item) => {
      try {
        const body = await api.readJob({ id: item.id, claim: item.claim });
        rememberAccountClaim(cleanText(body && body.account_claim_token, 300));
        const job = body && body.job;
        if (!job) throw new MiniApiError("The server returned no work status.");
        const returnEvent = ownerReturnEvent(item, job);
        saveProject(job, item.claim, item.transcript);
        return { ...item, ...job, refresh_status: "live", refresh_error: "", next_action: jobNextAction(job), return_event: returnEvent };
      } catch (error) {
        if (error.status === 404) {
          forgetProject(item.id);
          return null;
        }
        return { ...item, refresh_status: "unavailable", refresh_error: cleanText(error.message, 180) };
      }
    }));
    return refreshed.filter(Boolean);
  }

  function renderWorkList(list = projects()) {
    const labels = {
      queued: "Waiting",
      working: "In progress",
      checking: "Almost ready",
      ready: "Ready",
      needs_attention: "Needs attention",
      saved: "Saved",
      unavailable: "Could not refresh",
    };
    workList.innerHTML = list.length ? list.map((item) => `<button class="work-row" type="button" data-project-id="${esc(item.id)}" aria-label="${esc(workRowAccessibleName(item, labels))}">
      <strong>${esc(item.title || "Your solution")}</strong><small class="work-status${item.return_event ? " work-return-cue" : ""}">${esc(workStatusLabel(item, labels))}</small>
      <span>${esc(item.problem || "Private work")}</span>
      <small class="work-meta">Updated ${esc(formatDateTime(item.updated_at || item.created_at))} · ${item.available_until ? `Available until ${esc(formatDate(item.available_until))}` : "Availability date not provided"}</small>
      <small class="work-next">Next: ${esc(workNextAction(item))}</small>
    </button>`).join("") : `<div class="empty-work"><strong>Nothing here yet.</strong><p>Projects saved by this browser can appear here.</p></div>`;
  }

  async function openWork() {
    if (state.workRefreshing) return;
    state.workRefreshing = true;
    const workButton = document.querySelector('[data-action="work"]');
    if (workButton) {
      workButton.disabled = true;
      workButton.setAttribute("aria-busy", "true");
    }
    workList.innerHTML = '<div class="empty-work" role="status"><strong>Refreshing your work…</strong><p>I’m checking each private link for its current status.</p></div>';
    try {
      renderWorkList(await refreshProjects());
      if (typeof drawer.showModal === "function") drawer.showModal();
      else drawer.setAttribute("open", "");
    } finally {
      state.workRefreshing = false;
      if (workButton) {
        workButton.disabled = false;
        workButton.setAttribute("aria-busy", "false");
      }
    }
  }

  function finishDraftRestore() {
    messages.replaceChildren();
    state.transcript.forEach((item) => addMessage(item.role, item.text, { files: item.files, record: false }));
    renderAttachmentList();
    const assistantMessages = messages.querySelectorAll(".message-assistant");
    const lastAssistant = assistantMessages[assistantMessages.length - 1];
    if (state.phase === "decision") {
      const decisionMessage = lastAssistant || addMessage("assistant", "I have enough to build a useful first version.", { record: false });
      attachResume(decisionMessage);
    } else setComposer({ placeholder: state.phase === "problem" ? "Tell me what’s not working…" : "Type your answer…", hint: state.phase === "problem" ? "No tech words needed." : "A rough answer is fine.", attachments: true });
    if (state.transcript.length) {
      hideWelcome();
      scrollToEnd(true);
    }
    setBusy(false);
  }

  async function restoreConversation(draft) {
    state.intake = draft.intake;
    setDraftDeleteVisibility();
    state.phase = draft.phase;
    state.problem = draft.problem;
    state.userTurns = draft.userTurns;
    state.refining = draft.refining;
    state.attachments = draft.attachments;
    state.transcript = draft.transcript;
    setComposer({ locked: true, hint: "Opening your private conversation…", attachments: false });
    setBusy(true);
    const generation = state.generation;
    try {
      const body = await api.readIntake(state.intake);
      if (generation !== state.generation) return;
      updateIntake(body);
      const serverIntake = body && body.intake ? body.intake : body;
      if (cleanText(serverIntake && serverIntake.status, 80).toLowerCase() === "submitted") {
        const linked = linkedJobAccess(body);
        clearDraft();
        if (linked) {
          notify("Your free project was already started. Opening it now.");
          await openProject(linked, { source: "restored-submitted-intake" });
          return;
        }
        recoverSubmittedIntake();
        return;
      }
      const serverTranscript = Array.isArray(serverIntake && serverIntake.conversation)
        ? cleanTranscript(serverIntake.conversation)
        : [];
      if (serverTranscript.length) {
        state.transcript = serverTranscript;
        const firstProblem = state.transcript.find((item) => item.role === "user" && item.text);
        state.problem = firstProblem ? firstProblem.text : state.problem;
      } else if (state.transcript.length) {
        notify("I couldn’t confirm a saved server copy yet. This device’s draft is still here.");
      }
      state.attachments = cleanFiles(serverIntake && serverIntake.attachments);
      saveDraft();
    } catch (error) {
      if (generation !== state.generation) return;
      if (error.status === 404) {
        clearDraft();
        newConversation(false);
        addMessage("assistant", "I couldn’t reopen that draft. Start again here.", { record: false });
        return;
      }
      notify("I couldn’t check the saved copy just now. The copy on this device is still here.");
    }
    finishDraftRestore();
  }

  function handleSubmit() {
    if (state.phase === "ready") beginChange();
    else if (["problem", "guiding", "decision"].includes(state.phase)) submitProblemOrAnswer();
  }

  document.addEventListener("click", (event) => {
    const landingAction = event.target.closest('.marketing a[href="#conversation"]');
    if (landingAction) {
      window.requestAnimationFrame(() => messageInput.focus());
    }
    const solution = event.target.closest("[data-solution]");
    if (solution) {
      messageInput.value = solutionPrompts[solution.dataset.solution] || "";
      resizeComposer();
      messageInput.focus();
      return;
    }
    const guideAction = event.target.closest("[data-guide-action]");
    if (guideAction) {
      const action = guideAction.dataset.guideAction;
      if (action === "close") closeWorkedGuide();
      else if (action === "next") { workedGuideStep = Math.min(5, workedGuideStep + 1); renderWorkedGuide(); }
      else if (action === "back") { workedGuideStep = Math.max(0, workedGuideStep - 1); renderWorkedGuide(); }
      else if (action === "restart") { workedGuideStep = 0; renderWorkedGuide(); }
      else if (action === "use") useWorkedGuide();
      else if (action === "open-site") openSitePreview();
      else if (action === "choose") {
        guideAnswers[guideAction.dataset.guideKey] = cleanText(guideAction.dataset.guideValue, 200);
        const group = guideAction.closest(".guide-options, .look-options");
        if (group) group.querySelectorAll('[data-guide-action="choose"]').forEach((item) => item.setAttribute("aria-pressed", String(item === guideAction)));
        if (["presence", "wantsWebsite"].includes(guideAction.dataset.guideKey)) renderWorkedGuide();
      }
      else if (action === "follow") {
        const lead = guideAction.closest(".example-lead");
        lead.classList.toggle("is-done");
        guideAction.textContent = lead.classList.contains("is-done") ? "Followed up" : "Mark as followed up";
        const demo = guideAction.closest("[data-guide-demo]");
        const waiting = demo.querySelectorAll(".example-lead:not(.is-done)").length;
        demo.querySelector("[data-guide-waiting]").textContent = `${waiting} waiting`;
      }
      return;
    }
    const guidancePrompt = event.target.closest("[data-guidance-prompt]");
    if (guidancePrompt) {
      useGuidancePrompt(guidancePrompt);
      return;
    }
    const shareActionButton = event.target.closest("[data-share-action]");
    if (shareActionButton) {
      const row = shareActionButton.closest("[data-share-id]");
      const share = state.shares.find((item) => item.id === row?.dataset.shareId);
      if (share) mutateShare(share, shareActionButton.dataset.shareAction, shareActionButton);
      return;
    }
    const projectRow = event.target.closest("[data-project-id]");
    if (projectRow) {
      const item = projects().find((project) => project.id === projectRow.dataset.projectId);
        if (item) {
          if (drawer.open) drawer.close();
          openProject(item, { source: "work" });
      }
      return;
    }
    const remove = event.target.closest("[data-remove-file]");
    if (remove) {
      removeFile(remove.dataset.removeFile);
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "attach") fileInput.click();
    else if (action === "stop-response") stopResponse();
    else if (action === "new") {
      if (state.busy && !guideController) notify("I’m saving this first. It’ll only take a moment.");
      else if (confirmDiscardDraft()) newConversation(true);
    }
    else if (action === "work") openWork();
    else if (action === "tip") openTip(button);
    else if (action === "close-tip") closeDialog(tipDialog);
    else if (action === "share") openShare(button);
    else if (action === "close-share") closeDialog(shareDialog);
    else if (action === "refresh-shares") loadShares();
    else if (action === "open-self-host") openSelfHostGuide(button);
    else if (action === "close-self-host") closeDialog(selfHostDialog);
    else if (action === "open-service") openService(button);
    else if (action === "close-service") closeDialog(serviceDialog);
    else if (action === "guide") openWorkedGuide();
    else if (action === "close-work" && drawer.open) drawer.close();
    else if (action === "resume") resumeDraft(button);
    else if (action === "retry-mutation" && pendingMutation) startFreeWork(pendingMutation.context, button, true);
    else if (action === "stop-guide" && guideController) {
      guideAbortReason = "user";
      button.disabled = true;
      guideController.abort();
    }
    else if (action === "cancel-mutation") {
      button.disabled = true;
      cancelMutation();
    }
    else if (action === "copy-link") copyPrivateLink();
    else if (action === "retry") retryJob(button);
    else if (action === "request-change") requestChange();
    else if (action === "make-another") makeAnother();
    else if (action === "delete-work") deletePrivateWork(button);
    else if (action === "revoke-access") revokeAccess(button);
    else if (action === "delete-draft") deleteDraft();
  });

  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    handleSubmit();
  });

  messages.addEventListener("submit", (event) => {
    const form = event.target.closest("#shared-comment-form");
    if (!form) return;
    event.preventDefault();
    submitSharedComment(form);
  });

  tipForm.addEventListener("input", updateTipForm);
  tipForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitTip();
  });

  shareForm.addEventListener("change", (event) => {
    if (event.target.matches('input[name="share-mode"]')) updateShareMode();
  });
  shareForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitShare();
  });

  serviceForm.addEventListener("input", updateServiceForm);
  serviceForm.addEventListener("change", () => {
    const mode = serviceForm.querySelector('input[name="service-mode"]:checked')?.value || "";
    if (mode === "not_now") closeDialog(serviceDialog);
    else updateServiceForm();
  });
  serviceForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitServiceHandoff();
  });

  [tipDialog, shareDialog, selfHostDialog, serviceDialog].forEach((dialog) => {
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog(dialog);
    });
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  });

  if (finalComposer && finalProblem) {
    finalComposer.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = cleanText(finalProblem.value, MESSAGE_MAX_LENGTH);
      if (!value) {
        finalProblem.focus();
        return;
      }
      const existing = cleanText(messageInput.value, MESSAGE_MAX_LENGTH);
      if (existing && existing !== value) {
        notify("Your draft is still waiting in the main conversation. Finish it there or clear it before starting another.");
        conversation.scrollIntoView({ block: "start", behavior: "auto" });
        messageInput.focus();
        return;
      }
      messageInput.value = value;
      resizeComposer();
      conversation.scrollIntoView({ block: "start", behavior: "auto" });
      window.requestAnimationFrame(() => {
        messageInput.focus();
        if (!sendButton.disabled) composer.requestSubmit();
      });
    });
  }

  guideDialog.addEventListener("input", (event) => {
    const field = event.target.closest("[data-guide-field]");
    if (field) guideAnswers[field.dataset.guideField] = cleanText(field.value, 1000);
  });

  guideDialog.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-guide-example-form]");
    if (!form) return;
    event.preventDefault();
    const name = cleanText(new FormData(form).get("name"), 80);
    if (!name) return;
    const demo = form.closest("[data-guide-demo]");
    const lead = document.createElement("div");
    lead.className = "example-lead";
    lead.innerHTML = `<strong>${esc(name)}</strong><span>New enquiry - just now</span><button type="button" data-guide-action="follow">Mark as followed up</button>`;
    demo.querySelector("[data-guide-leads]").prepend(lead);
    form.reset();
    const waiting = demo.querySelectorAll(".example-lead:not(.is-done)").length;
    demo.querySelector("[data-guide-waiting]").textContent = `${waiting} waiting`;
    guideStage.querySelector("[data-guide-result]").textContent = `${name}'s enquiry is now in the follow-up list.`;
  });

  guideDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeWorkedGuide();
  });

  thread.addEventListener("scroll", () => {
    if (!ENABLE_QUIET_STREAM_DELIVERY) return;
    state.followingLatest = streamAtEnd();
    if (state.followingLatest) setLatestPending(false);
  }, { passive: true });

  jumpToLatestButton.addEventListener("click", jumpToLatest);
  jumpToLatestButton.addEventListener("focusout", () => {
    if (!state.newReplyPending) jumpToLatestButton.hidden = true;
  });

  messageInput.addEventListener("input", () => {
    clearComposerRecovery();
    if (state.phase === "ready") showChangeLimit();
    resizeComposer();
  });
  messageInput.addEventListener("focusout", () => {
    window.requestAnimationFrame(resizeComposer);
  });
  messageInput.addEventListener("focusin", scheduleComposerBudget);
  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!sendButton.disabled) composer.requestSubmit();
    }
  });

  fileInput.addEventListener("change", () => stageFiles(fileInput.files));

  ["dragenter", "dragover"].forEach((name) => composer.addEventListener(name, (event) => {
    if (fileInput.disabled) return;
    event.preventDefault();
    composer.classList.add("is-dragging");
  }));
  ["dragleave", "drop"].forEach((name) => composer.addEventListener(name, (event) => {
    if (fileInput.disabled) return;
    event.preventDefault();
    composer.classList.remove("is-dragging");
    if (name === "drop") stageFiles(event.dataTransfer && event.dataTransfer.files);
  }));

  composer.addEventListener("paste", (event) => {
    if (fileInput.disabled) return;
    const files = Array.from((event.clipboardData && event.clipboardData.files) || []);
    if (files.length) stageFiles(files);
  });

  drawer.addEventListener("click", (event) => {
    if (event.target === drawer) drawer.close();
  });

  window.addEventListener("hashchange", () => {
    const publicAccess = publicAccessFromHash();
    if (publicAccess) {
      const currentKey = state.publicShare && (state.publicShare.token || state.publicShare.id);
      const nextKey = publicAccess.token || publicAccess.id;
      if (currentKey !== nextKey) openPublicShare(publicAccess);
      return;
    }
    const access = accessFromHash();
    if (access && (access.id !== state.current?.id || access.claim !== state.current?.claim)) openProject(access);
    else if (!access && (state.current || state.publicShare)) newConversation(false);
  });

  window.addEventListener("online", refreshNetworkState);
  window.addEventListener("offline", refreshNetworkState);
  document.addEventListener("visibilitychange", () => {
    document.documentElement.classList.toggle("motion-paused", document.hidden);
    if (!document.hidden) refreshNetworkState();
  });

  function setupLandingMotion() {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const staticCapture = new URLSearchParams(window.location.search).has("static");
    document.documentElement.classList.add("js-enhanced");
    document.documentElement.classList.toggle("static-capture", staticCapture);

    if (siteHeader) {
      const syncHeader = () => siteHeader.classList.toggle("compact", window.scrollY > 32);
      syncHeader();
      window.addEventListener("scroll", syncHeader, { passive: true });
    }

    const reveals = document.querySelectorAll(".reveal");
    if (reduceMotion || staticCapture || !("IntersectionObserver" in window)) {
      reveals.forEach((item) => item.classList.add("visible"));
    } else {
      const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("visible");
          revealObserver.unobserve(entry.target);
        });
      }, { threshold: 0.12 });
      reveals.forEach((item) => revealObserver.observe(item));
    }

    const words = Array.from(document.querySelectorAll(".rotator span"));
    if (!reduceMotion && !staticCapture && words.length > 1) {
      let wordIndex = Math.max(0, words.findIndex((word) => word.classList.contains("active")));
      window.setInterval(() => {
        if (document.hidden || !document.querySelector(".technical")?.matches(":not([hidden])")) return;
        words[wordIndex].classList.remove("active");
        wordIndex = (wordIndex + 1) % words.length;
        words[wordIndex].classList.add("active");
      }, 2200);
    }
  }

  let composerBudgetFrame = 0;

  function scheduleComposerBudget() {
    if (document.activeElement !== messageInput || composerBudgetFrame) return;
    composerBudgetFrame = window.requestAnimationFrame(() => {
      composerBudgetFrame = 0;
      resizeComposer();
    });
  }

  setupLandingMotion();
  window.addEventListener("resize", scheduleComposerBudget);

  // Content in the dock can appear after the input event. Observe only DOM
  // changes (not inline style), so this settles without a resize-observer loop.
  const composerBudgetObserver = new MutationObserver(scheduleComposerBudget);
  composerBudgetObserver.observe(composerDock, {
    attributes: true,
    attributeFilter: ["hidden"],
    childList: true,
    characterData: true,
    subtree: true,
  });

  resizeComposer();
  api.config().then((config) => {
    state.config = {
      ...state.config,
      ...config,
      attachments: { ...DEFAULT_LIMITS, ...(config.attachments || {}) },
    };
    if (state.phase === "ready" && state.current) {
      setComposer({ placeholder: "Tell me what you want changed…", hint: "Plain words are perfect.", attachments: jobAttachmentsAvailable() });
    }
  }).catch(() => {});

  if (new URLSearchParams(location.search).get("qa") === "return-receipt-fixtures") {
    window.__miniFrankReturnReceiptFixtureFailures = returnReceiptFixtureFailures();
  }

  const initialPublicAccess = publicAccessFromHash();
  const initialAccess = accessFromHash();
  if (initialPublicAccess) openPublicShare(initialPublicAccess);
  else if (initialAccess) openProject(initialAccess);
  else {
    const draft = restoredDraft();
    if (draft) restoreConversation(draft);
    else newConversation(false);
  }
}());
