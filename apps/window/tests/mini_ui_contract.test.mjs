import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const miniDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web/mini");

async function source(name) {
  return readFile(path.join(miniDir, name), "utf8");
}

test("the reviewed cool Open Workroom surface is the canonical Mini Frank entry", async () => {
  const [html, css, script] = await Promise.all([source("index.html"), source("mini.css"), source("mini.js")]);
  assert.match(html, /<title>Mini Frank — useful work, without the technical fuss<\/title>/);
  assert.match(html, /href="\/mini-frank\/mini\.css"/);
  assert.match(html, /src="\/mini-frank\/mini\.js"/);
  assert.match(script, /from "\.\/mini_stream\.mjs"/);
  assert.match(script, /from "\.\/mini_api\.mjs"/);
  assert.match(script, /from "\.\/mini_result\.mjs"/);
  assert.match(script, /from "\.\/mini_retry\.mjs"/);
  assert.match(html, /What could we solve[\s\S]*for your business\?/);
  assert.match(html, /Illustrative example/g);
  assert.doesNotMatch(css, /#[0-9a-f]{0,2}(?:f5c|d8a|8b5)|yellow|brown/i);
  assert.doesNotMatch(`${html}\n${css}`, /Inter-var|InstrumentSans-Variable|\/fonts\//);
});

test("free chat stays dominant and tip copy cannot imply entitlement", async () => {
  const html = await source("index.html");
  assert.match(html, /id="conversation"/);
  assert.match(html, /data-action="tip"[^>]*>Tip Frank/);
  assert.match(html, /Everything in Mini Frank is free\. This is just a tip\./);
  assert.match(html, /A tip does not unlock anything, change your result, or give you priority\./);
  assert.match(html, /value="5"[\s\S]*value="15"[\s\S]*value="30"[\s\S]*value="custom"/);
  assert.doesNotMatch(html, /name="tip-amount"[^>]*checked/);
  assert.doesNotMatch(html, /email flow|newsletter|subscribe/i);
});

test("result controls preserve the approved action order and project-specific continuation", async () => {
  const script = await source("mini.js");
  assert.match(script, /<div class="result-primary-actions">\$\{openActions\}<button[^>]+result-action-change[^>]*>Change it — free<\/button><button[^>]+result-action-share[^>]+data-action="share"[^>]*>Share<\/button><\/div>\s*<div class="result-download-actions">\$\{downloadActions\}[\s\S]*?\$\{resultGuidanceMarkup\(guidance\)\}/);
  assert.match(script, /setCurrentResultRevising\(true\)/);
  assert.match(script, /replaceExisting: context === "change"/);
  assert.match(script, /CHANGE_MAX_LENGTH = 2000/);
  assert.match(script, /state\.phase === "ready" \? CHANGE_MAX_LENGTH : MESSAGE_MAX_LENGTH/);
  assert.match(script, /rawText\.length > CHANGE_MAX_LENGTH[\s\S]*Keep this change to 2,000 characters or less/);
  assert.doesNotMatch(script, /project_limit_reached|additional active build projects|paid feature|building more projects/i);
});

test("sharing is Google-Docs-like without pretending deferred identity or template support works", async () => {
  const [html, script] = await Promise.all([source("index.html"), source("mini.js")]);
  assert.match(html, /value="restricted"/);
  assert.match(html, /value="link"/);
  assert.match(html, /value="published"/);
  assert.match(html, /value="viewer"/);
  assert.match(html, /value="commenter"/);
  assert.match(html, /value="editor"[\s\S]*Can suggest changes/);
  assert.match(html, /Named invitations are not connected yet/);
  assert.match(html, /Sharing never grants spending or execution authority/);
  assert.doesNotMatch(html, /name="share-people"|value="template"|Can edit content/);
  assert.match(script, /publicAccessFromHash\(\)/);
  assert.match(script, /api\.readShared\(access\.token\)/);
  assert.match(script, /api\.readPublished\(access\.id\)/);
  assert.match(script, /api\.readSharedComments/);
  assert.match(script, /api\.createSharedComment/);
  assert.match(script, /Shared access can never run connected actions, approve payment/);
});

test("restricted to link creation is atomic and every product dialog is wired", async () => {
  const script = await source("mini.js");
  assert.match(script, /payload\.mode === "link" && !activeLink[\s\S]*api\.createShare\(access, \{ role: payload\.role, scope: payload\.scope \}, options\)/);
  assert.match(script, /else await api\.updateSharing\(access, payload, options\)/);
  assert.match(script, /populateShareForm\(current\)/);
  for (const action of ["tip", "close-tip", "share", "close-share", "refresh-shares", "open-self-host", "close-self-host", "open-service", "close-service"]) {
    assert.match(script, new RegExp(`action === "${action}"`), action);
  }
  assert.match(script, /tipForm\.addEventListener\("submit"/);
  assert.match(script, /shareForm\.addEventListener\("submit"/);
  assert.match(script, /serviceForm\.addEventListener\("submit"/);
  assert.match(script, /\[tipDialog, shareDialog, selfHostDialog, serviceDialog\][\s\S]*"cancel"/);
});

test("service handoff is progressive, reviewed, optional and never starts execution", async () => {
  const [html, script, resultScript] = await Promise.all([source("index.html"), source("mini.js"), source("mini_result.mjs")]);
  assert.match(resultScript, /Open the free self-hosting guide/);
  assert.match(html, /value="self_host_help"/);
  assert.match(html, /value="managed_hosting"/);
  assert.match(html, /value="video_call"/);
  assert.match(html, /value="perth_visit"/);
  assert.match(html, /value="custom_project"[\s\S]*Written scope/);
  assert.match(html, /value="not_now"/);
  assert.match(html, /id="service-contact-method"[^>]*required[\s\S]*value="email"[\s\S]*value="phone"[\s\S]*value="whatsapp"[\s\S]*value="other"/);
  assert.match(html, /id="service-contact-value"[^>]*required/);
  assert.match(html, /Saved privately for operator review/);
  assert.match(html, /id="service-handoff"[^>]*maxlength="2000"/);
  assert.match(script, /SERVICE_NOTE_MAX_LENGTH = 2000/);
  assert.match(script, /owner_reviewed: true/);
  assert.match(script, /api\.readServiceOptions/);
  assert.match(script, /api\.createServiceRequest/);
  assert.match(script, /serviceRequestReplay\.keyFor\(signature\)[\s\S]*api\.createServiceRequest\(access, payload, \{ idempotencyKey \}\)[\s\S]*serviceRequestReplay\.confirm\(signature\)/);
  assert.match(script, /sharedCommentReplay\.keyFor\(signature\)[\s\S]*api\.createSharedComment[\s\S]*sharedCommentReplay\.confirm\(signature\)/);
  assert.match(script, /mode === "service"[\s\S]*openService\(button, prompt\)[\s\S]*return/);
  assert.match(script, /serviceHandoff\.value = cleanText\(handoffOverride, SERVICE_NOTE_MAX_LENGTH\) \|\| options\.handoff/);
  assert.match(script, /returnTrigger = selfHostDialog\.open[\s\S]*showDialog\(serviceDialog, returnTrigger\)/);
  assert.match(script, /Your request is saved\. We’ll be in touch if you asked for hands-on help\./);
  assert.match(script, /Nothing starts automatically\./);
  assert.doesNotMatch(script, /api\.createServiceHandoff/);
});

test("account claim is a separate ma1 token and never enters URLs or shares", async () => {
  const [script, apiScript] = await Promise.all([source("mini.js"), source("mini_api.mjs")]);
  const mutationKeySource = script.split("function mutationKey()", 2)[1].split("\n  }", 1)[0];
  const apiKeySource = apiScript.split("function key()", 2)[1].split("\n}", 1)[0];
  assert.match(script, /function validAccountClaim/);
  assert.match(script, /\^ma1\\\./);
  assert.match(script, /rememberAccountClaim\(cleanText\(body && body\.account_claim_token/);
  assert.match(script, /api\.readJob\(access\)[\s\S]{0,220}rememberAccountClaim\(cleanText\(body && body\.account_claim_token/);
  for (const secureKeySource of [mutationKeySource, apiKeySource]) {
    assert.match(secureKeySource, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
    assert.doesNotMatch(secureKeySource, /Math\.random\(\)/);
  }
  assert.match(script, /createIntake\(conversationPayload\(\), \{ accountClaim: state\.accountClaim \}\)/);
  assert.doesNotMatch(script, /new URLSearchParams\([^)]*accountClaim|key: state\.accountClaim/);
});

test("a submitted intake restore opens only server-issued job access or starts a distinct free project", async () => {
  const script = await source("mini.js");
  assert.match(script, /function linkedJobAccess\(body\) \{[\s\S]*const linked = body && body\.linked_job;[\s\S]*linked\.job_id[\s\S]*linked\.claim_token[\s\S]*validId\(id\) && validClaim\(claim\)/);
  assert.match(script, /function recoverSubmittedIntake\(\) \{[\s\S]*clearDraft\(\);[\s\S]*newConversation\(false\);[\s\S]*previous free solution is already under way/);
  const restore = script.split("async function restoreConversation(draft)", 2)[1].split("function handleSubmit()", 2)[0];
  const submitted = restore.split('toLowerCase() === "submitted")', 2)[1].split("const serverTranscript", 2)[0];
  assert.match(submitted, /const linked = linkedJobAccess\(body\);[\s\S]*clearDraft\(\);[\s\S]*if \(linked\) \{[\s\S]*await openProject\(linked, \{ source: "restored-submitted-intake" \}\);[\s\S]*return;[\s\S]*recoverSubmittedIntake\(\);[\s\S]*return;/);
  assert.doesNotMatch(submitted, /finishDraftRestore\(|attachResume\(/);
});

test("an incomplete restored guide stays saved and retryable instead of inventing a start decision", async () => {
  const script = await source("mini.js");
  const recovery = script.split("function incompleteGuideRecovery(intake)", 2)[1].split("function finishDraftRestore", 2)[0];
  assert.match(recovery, /lastSavedMessage\.role !== "user"/);
  assert.match(recovery, /intake\.guide_status/);
  assert.match(recovery, /intake\.guide_resumable/);
  assert.match(recovery, /status === "complete" && lastSavedMessage && lastSavedMessage\.role === "assistant"[\s\S]*state\.phase = state\.guideCard && state\.guideCard\.next\.kind !== "confirm" \? "guiding" : "decision"/);
  assert.match(recovery, /status === "working"[\s\S]*Your message is saved\. I don’t have a finished reply yet/);
  assert.match(recovery, /resumable \|\| \["unavailable", "failed", "aborted"\][\s\S]*Your message is saved, but I couldn’t finish the reply\. Try again when you’re ready\./);
  const restore = script.split("async function restoreConversation(draft)", 2)[1].split("function handleSubmit()", 2)[0];
  assert.match(restore, /finishDraftRestore\(incompleteGuideRecovery\(serverIntake\)\);/);
  const finish = script.split('function finishDraftRestore(recovery = "")', 2)[1].split("async function restoreConversation", 2)[0];
  assert.match(finish, /if \(recovery\) \{[\s\S]*Try again in your own words…[\s\S]*\} else if \(state\.phase === "decision" && lastAssistant\) \{[\s\S]*attachResume\(lastAssistant\);/);
  assert.doesNotMatch(finish, /I have enough to start solving this|lastAssistant \|\| addMessage/);
});

test("a complete server guide overrides a stale local guiding phase", async () => {
  const script = await source("mini.js");
  const recovery = script.split("function incompleteGuideRecovery(intake)", 2)[1].split("function finishDraftRestore", 2)[0];
  assert.match(recovery, /status === "complete" && lastSavedMessage && lastSavedMessage\.role === "assistant"[\s\S]*state\.phase = state\.guideCard && state\.guideCard\.next\.kind !== "confirm" \? "guiding" : "decision"[\s\S]*return ""/);
  const finish = script.split('function finishDraftRestore(recovery = "")', 2)[1].split("async function restoreConversation", 2)[0];
  assert.match(finish, /state\.phase === "decision" && lastAssistant[\s\S]*attachResume\(lastAssistant\)/);
});

test("the live guide canary never resets a browser with an unfinished reply", async () => {
  const canary = await readFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "mini_browser_canary.js"), "utf8");
  assert.match(canary, /submittedJob:[\s\S]*\/api\/mini\/intakes\/[\s\S]*endsWith\("\/submit"\)[\s\S]*\/api\/mini\/jobs/);
  assert.match(canary, /guideRuns\.push\([\s\S]*if \(!checkpoints\.complete\) \{[\s\S]*throw new Error\(`Guide run \$\{run\} did not complete before the next browser reset`\);/);
});

test("the free conversation shows only complete replies and keeps every decision in plain business language", async () => {
  const script = await source("mini.js");
  assert.match(script, /BUFFER_GUIDE_REPLIES_UNTIL_COMPLETE = true/);
  const streamQueue = script.split("const queueStreamText = (partial) =>", 2)[1].split("updateSendButton();", 2)[0];
  assert.match(streamQueue, /if \(BUFFER_GUIDE_REPLIES_UNTIL_COMPLETE\) \{[\s\S]*pendingStreamText = partial;[\s\S]*return;[\s\S]*\}[\s\S]*thinking\.remove\(\)/);
  assert.match(script, /data-action="resume">Solve this for me — free<\/button>/);
  assert.match(script, /placeholder: "Answer in your own words…"[\s\S]*hint: "A rough answer is enough\. You can also solve it now with what you’ve shared\."/);
  assert.match(script, /if \(options\.hint\) \{[\s\S]*composerStatus\.textContent = options\.hint;[\s\S]*composerStatus\.hidden = false;/);
  assert.doesNotMatch(script, />Start build<|>Try build again<|>Open build notes</);
  const guide = script.split("async function guideAfter(", 2)[1].split("async function submitProblemOrAnswer(", 2)[0];
  const recovery = guide.split("if (!reply)", 2)[1].split("let assistantMessage", 2)[0];
  assert.match(recovery, /const recovery = addMessage\([\s\S]*attachResume\(recovery\);/);
  const submit = script.split("async function submitIntake(options = {})", 2)[1].split("async function startFreeWork", 2)[0];
  assert.doesNotMatch(submit, /conversation\s*:/);
});

test("adaptive guide cards stay inside the conversation and preserve the free default", async () => {
  const [script, css] = await Promise.all([source("mini.js"), source("mini.css")]);
  assert.match(script, /from "\.\/mini_guide\.mjs"/);
  assert.match(script, /class="guide-decision-card" data-guide-kind="\$\{esc\(next\.kind\)\}" data-guide-card-id="\$\{esc\(next\.id\)\}"/);
  assert.match(script, /class="guide-decision-question"/);
  assert.match(script, /class="guide-understanding"/);
  assert.match(script, /data-guide-choice="\$\{esc\(option\.id\)\}" data-recommended="\$\{String\(option\.recommended\)\}"/);
  assert.match(script, /data-action="guide-choose-for-me"/);
  assert.match(script, /data-action="guide-other"/);
  assert.match(script, /class="guide-mini-preview guide-mini-preview-\$\{esc\(preview\.kind\)\}"/);
  assert.doesNotMatch(script, /class="guide-mini-preview[^>]*aria-hidden="true"/);
  const outcome = script.split("function attachGuideOutcome", 2)[1].split("function visibleGuideDecision", 2)[0];
  assert.match(outcome, /if \(!card\)[\s\S]*visibleReply\.endsWith\("\?"\)[\s\S]*state\.phase = "guiding"[\s\S]*return null;[\s\S]*attachResume\(message, options\)/);
  assert.match(outcome, /if \(card\.next\.kind === "confirm"\) attachResume\(message, options\)/);
  assert.doesNotMatch(outcome, /card\.next\.kind !== "confirm"[\s\S]*attachResume/);
  assert.match(script, /guideChoiceAnswer\(state\.guideCard, guideChoice\.dataset\.guideChoice\)/);
  assert.match(script, /guideChooseForMeAnswer\(state\.guideCard\)/);
  assert.match(css, /\.guide-choice\s*\{[\s\S]*min-height:\s*76px/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*\.guide-choice-grid\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.guide-decision-card, \.guide-choice\s*\{\s*transition:\s*none/);
});

test("the active guide card is draft-restored only after server reconciliation", async () => {
  const script = await source("mini.js");
  assert.match(script, /guideCard:\s*null/);
  assert.match(script, /guideCard:\s*normalizeGuideCard\(state\.guideCard\)/);
  assert.match(script, /guideCard:\s*normalizeGuideCard\(value\.guideCard\)/);
  const restore = script.split("async function restoreConversation(draft)", 2)[1].split("function handleSubmit()", 2)[0];
  assert.match(restore, /state\.guideCard = normalizeGuideCard\(draft\.guideCard\)/);
  assert.match(restore, /state\.guideCard = normalizeGuideCard\(serverIntake && serverIntake\.guide_card\)/);
  assert.match(restore, /finishDraftRestore\(incompleteGuideRecovery\(serverIntake\)\)/);
  const finish = script.split('function finishDraftRestore(recovery = "")', 2)[1].split("async function restoreConversation", 2)[0];
  assert.match(finish, /lastAssistant && state\.guideCard[\s\S]*attachGuideOutcome\(lastAssistant, state\.guideCard, \{ focus: false, scroll: false \}\)/);
  const understanding = script.split("function guideUnderstandingMarkup", 2)[1].split("function guidePreviewMarkup", 2)[0];
  assert.match(understanding, /card\.understanding\.map\(\(fact\) =>/);
  assert.doesNotMatch(understanding, /\.slice\(/);
});

test("structured guide state is captured only from the terminal assistant event", async () => {
  const script = await source("mini.js");
  const send = script.split("async function sendGuideTurn", 2)[1].split("async function guideAfter", 2)[0];
  assert.match(send, /if \(isAssistantCompleted\(item\.event, item\.data\)\) \{[\s\S]*guideCard = normalizeGuideCard\(item\.data && \(item\.data\.guide \|\| item\.data\.guide_card\)\)/);
  assert.doesNotMatch(send.split("const apply =", 2)[0], /guideCard = normalizeGuideCard\(item\.data/);
  assert.match(send, /return \{ text: cleanText\(answer, 12000\), guideCard, guideVersion \}/);
});

test("guide answers bind to the current server card and reconcile stale tabs", async () => {
  const script = await source("mini.js");
  const send = script.split("async function sendGuideTurn", 2)[1].split("async function guideAfter", 2)[0];
  assert.match(send, /const expectedCardId = cleanText\(binding && binding\.cardId, 64\)/);
  assert.match(send, /const requestBody = \{[\s\S]*guide_intent: normalizeGuideIntent\(binding && binding\.intent\)[\s\S]*\};[\s\S]*if \(expectedCardId\) \{[\s\S]*requestBody\.expected_guide_version = cleanGuideVersion\(binding && binding\.version\);[\s\S]*requestBody\.expected_card_id = expectedCardId;/);
  assert.match(send, /guideVersion = cleanGuideVersion\(item\.data && item\.data\.guide_version, guideVersion\)/);
  const guideAfter = script.split("async function guideAfter", 2)[1].split("async function submitProblemOrAnswer", 2)[0];
  assert.match(guideAfter, /error && error\.status === 409 && error\.intake[\s\S]*conflictIntake = error\.intake/);
  assert.match(guideAfter, /if \(conflictIntake\) \{[\s\S]*reconcileGuideConflict\(conflictIntake\);[\s\S]*return;/);
  const reconcile = script.split("function reconcileGuideConflict", 2)[1].split("function incompleteGuideRecovery", 2)[0];
  assert.match(reconcile, /state\.guideVersion = cleanGuideVersion\(intake\.guide_version, state\.guideVersion\)/);
  assert.match(reconcile, /state\.guideCard = normalizeGuideCard\(intake\.guide_card\)/);
  assert.match(reconcile, /finishDraftRestore\(incompleteGuideRecovery\(intake\)\)/);
});

test("every guide path sends a bounded intent and consumes older solve actions", async () => {
  const script = await source("mini.js");
  const submit = script.split("async function submitProblemOrAnswer", 2)[1].split("function resumeDraft", 2)[0];
  assert.match(submit, /const defaultIntent = activeCard[\s\S]*activeCard\.next\.kind === "confirm" \? "change" : "other"[\s\S]*: "choice"/);
  assert.doesNotMatch(submit, /text\.length < 10|Add \$\{10 - text\.length\} more character/);
  assert.match(submit, /intent: normalizeGuideIntent\(intentValue \|\| state\.guideIntent \|\| defaultIntent\)/);
  assert.match(submit, /disablePriorGuideResumeActions\(\);[\s\S]*state\.guideCard = null/);
  assert.match(script, /function sendGuideCardAnswer\(answer, button, choiceId = "", intentValue = "choice"\)/);
  assert.match(script, /guide-choose-for-me"\) \{[\s\S]*sendGuideCardAnswer\(guideChooseForMeAnswer\(state\.guideCard\), button, "", "choose_for_me"\)/);
  assert.match(script, /action === "guide-other"[\s\S]*state\.guideIntent = "other"/);
  assert.match(script, /action === "guide-change"[\s\S]*state\.guideIntent = "change"/);
  assert.match(script, /action === "guide-change-fact"[\s\S]*state\.guideIntent = "change"/);
  const disable = script.split("function disablePriorGuideResumeActions", 2)[1].split("function attachGuideOutcome", 2)[0];
  assert.match(disable, /querySelectorAll\('\[data-action="resume"\]:not\(:disabled\)'\)[\s\S]*button\.disabled = true/);
  const settle = script.split("function settleGuideDecision", 2)[1].split("function sendGuideCardAnswer", 2)[0];
  assert.match(settle, /\[data-action=\\"guide-change\\"\], \[data-action=\\"guide-change-fact\\"\][\s\S]*button\.disabled = true/);
  const change = script.split('action === "guide-change"', 2)[1].split('action === "guide-change-fact"', 2)[0];
  assert.match(change, /decision\.dataset\.guideCardId !== card\.next\.id \|\| decision\.dataset\.guideAnswered[\s\S]*That detail has already moved on/);
});

test("understood facts are targeted, editable and use unique accessible card headings", async () => {
  const script = await source("mini.js");
  assert.match(script, /data-guide-fact="\$\{esc\(fact\.key\)\}"/);
  assert.match(script, /data-action="guide-change-fact" data-guide-fact-key="\$\{esc\(fact\.key\)\}" data-guide-fact-label="\$\{esc\(fact\.label\)\}" data-guide-fact-value="\$\{esc\(fact\.value\)\}"/);
  assert.match(script, /placeholder: `Change “\$\{label\}: \$\{value\}”…`/);
  assert.match(script, /state\.guideFact = \{ key: fact\.key, label: fact\.label, value: fact\.value \}/);
  assert.match(script, /const pendingFact = activeCard && state\.guideFact[\s\S]*fact\.key === state\.guideFact\.key/);
  assert.match(script, /const correction = pendingFact && text[\s\S]*`Change \$\{pendingFact\.label\}: \$\{text\}/);
  assert.match(script, /decision\.dataset\.guideCardId !== card\.next\.id \|\| decision\.dataset\.guideAnswered/);
  assert.match(script, /let guideDomSequence = 0/);
  assert.match(script, /const headingId = `guide-decision-\$\{next\.id\}-\$\{domSuffix\}`/);
  assert.match(script, /guideDomSequence \+= 1;[\s\S]*guideDecisionMarkup\(card, guideDomSequence\)/);
});

test("guide previews remain readable and quiet delivery preserves the reader position", async () => {
  const [script, css] = await Promise.all([source("mini.js"), source("mini.css")]);
  assert.match(css, /\.guide-mini-preview \{[\s\S]*min-height:\s*210px;[\s\S]*height:\s*auto/);
  assert.match(css, /\.guide-preview-copy strong \{[^}]*font-size:\s*13px/);
  assert.match(css, /\.guide-preview-copy small \{[^}]*font-size:\s*11px/);
  assert.match(css, /\.guide-preview-items span \{[^}]*font-size:\s*11px;[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.guide-preview-action \{[^}]*font-size:\s*11px/);
  assert.match(css, /\.guide-fact-change \{[^}]*font-size:\s*11px/);
  assert.match(css, /\.guide-best-guess, \.guide-recommended \{[^}]*font-size:\s*11px/);
  assert.match(css, /\.guide-choice-copy small \{[^}]*font-size:\s*11px/);
  assert.doesNotMatch(css, /\.guide-preview-(?:copy|items|action)[^{]*\{[^}]*(?:font-size:\s*(?:6\.5|7)px)/);
  const render = script.split("function renderGuideDecision", 2)[1].split("function disablePriorGuideResumeActions", 2)[0];
  assert.match(render, /if \(options\.quietStream\) \{[\s\S]*if \(options\.followAtEnd\) scrollStreamToEnd\(\)/);
  assert.doesNotMatch(render, /scrollToEnd\(true\)/);
  assert.match(render, /heading\.focus\(\{ preventScroll: true \}\)/);
});

test("customer-facing recovery, status and result copy never expose internal failures or mechanics", async () => {
  const script = await source("mini.js");
  assert.doesNotMatch(script, /error\.message|body\.error|body\.message|body\.reason|failure && failure\.message/);
  assert.match(script, /I couldn’t finish that reply just now\. Your message and files are still here — try again in a moment\./);
  assert.match(script, /I couldn’t confirm that started\. Nothing has been lost\. Try again when you’re ready\./);
  assert.match(script, /That file didn’t come through\. Your message is still here\./);
  assert.match(script, /This is a quick look\. Open or download it below to use the full version\./);
  assert.doesNotMatch(script, /This preview is static and sandboxed|Sandboxed preview|private link if you want|status checks resume|saved server copy|Open build notes/);
  assert.match(script, /Opening your conversation…/);
  assert.match(script, /That saved conversation is no longer available\. Start again here\./);
  assert.match(script, /Your solution is queued\.|We’re putting it together\.|Giving it a final check\./);
  assert.doesNotMatch(script, /The service last reported/);
});

test("CSP, reduced motion, sandboxing and 320px reflow remain release constraints", async () => {
  const [html, css, script] = await Promise.all([source("index.html"), source("mini.css"), source("mini.js")]);
  assert.match(css, /min-width:\s*320px/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(script, /sandbox loading="lazy"/);
  assert.doesNotMatch(`${html}\n${script}`, /style=|\.style\./);
  assert.match(css, /\.clipboard-proxy/);
});

test("the illustrative enquiry guide still opens a real local page", async () => {
  const [html, script, previewHtml, previewScript] = await Promise.all([
    source("index.html"), source("mini.js"), source("site-preview.html"), source("site-preview.js"),
  ]);
  assert.match(html, /Step 1 of 6/);
  assert.match(script, /Facebook page/);
  assert.match(script, /data-guide-action="open-site"/);
  assert.match(script, /window\.open\(sitePreviewUrl\(\)/);
  assert.match(previewHtml, /id="site-enquiry-form"/);
  assert.match(previewScript, /Sample acknowledgement shown/);
  assert.match(previewScript, /has not sent an enquiry/);
});
