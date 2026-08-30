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
  assert.match(script, /Frank hasn’t contacted you yet/);
  assert.match(script, /No payment or implementation has been approved or started/);
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
