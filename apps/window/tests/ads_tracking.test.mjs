// Tracking screen contract.
//
// Every test here exists because the behaviour it asserts was wrong in the
// reviewed build, and the wrongness was expensive in a specific way: tracking
// parameters that were written after the `#`, so the browser sent them to the
// page but no server ever received them; a keystroke that lost to a draft saved
// before it, so the panel resolved a value the box was not showing; a
// percent-encoded email address that walked past the personal-information
// check; a placeholder that reached a URL with nothing said about it; and two
// ad variations that shared one tracking identity without the screen saying so.
//
// These are rule-level tests and run without a browser. The modules import
// cleanly in Node, and the address the preview draws is built by an exported
// pure function, so the string asserted here is the string the panel shows.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPreviewUrl,
  destinationDraftEntry,
  duplicateParams,
  editorValueFrom,
  evaluate,
  rawParams,
  sampleMap,
  sharedIdentifier,
  urlFindings,
} from "../web/js/ads/ads-tracking.js";

const BASE = "https://example.invalid/guides/survey";

const fields = () => [
  { key: "utm_source", label: "Source", value: "{{platform}}", required: true },
  { key: "utm_medium", label: "Medium", value: "paid_social", required: true },
  { key: "utm_campaign", label: "Campaign", value: "{{campaign.internal_id}}", required: true },
  { key: "utm_content", label: "Content", value: "{{creative.internal_id}}", required: true },
  { key: "utm_term", label: "Term", value: "", required: false },
];

const sample = () =>
  new Map([
    ["campaign.internal_id", "cmp_001"],
    ["creative.internal_id", "cr_001"],
    ["platform", "meta"],
  ]);

const ofKind = (findings, kind) => findings.filter((finding) => finding.kind === kind);

/* --------------------------------------------- the address a template writes --- */

test("existing query parameters and the anchor both survive the tracking parameters", () => {
  // The owner's acceptance case: a query parameter and an anchor already there.
  const built = buildPreviewUrl(fields(), sample(), `${BASE}?ref=newsletter#tips`);
  assert.equal(built.url, `${BASE}?ref=newsletter&utm_source=meta&utm_medium=paid_social&utm_campaign=cmp_001&utm_content=cr_001#tips`);

  // Asserted through a URL parser as well as by string, because the point is
  // what a browser would send: parameters in the query, anchor at the end.
  const parsed = new URL(built.url);
  assert.equal(parsed.searchParams.get("ref"), "newsletter");
  assert.equal(parsed.searchParams.get("utm_source"), "meta");
  assert.equal(parsed.searchParams.get("utm_campaign"), "cmp_001");
  assert.equal(parsed.hash, "#tips");

  // The percent-encoded form the panel offers as "the form to write" obeys the
  // same rule.
  const encoded = new URL(buildPreviewUrl(fields(), sample(), `${BASE}#tips`).encoded);
  assert.equal(encoded.hash, "#tips");
  assert.equal(encoded.searchParams.get("utm_content"), "cr_001");
});

test("an anchor alone, and a destination that ends in a bare question mark", () => {
  assert.equal(
    buildPreviewUrl(fields(), sample(), `${BASE}#tips`).url,
    `${BASE}?utm_source=meta&utm_medium=paid_social&utm_campaign=cmp_001&utm_content=cr_001#tips`,
  );
  // No `?&`: the separator is only written when it is needed.
  assert.equal(
    buildPreviewUrl(fields(), sample(), `${BASE}?`).url,
    `${BASE}?utm_source=meta&utm_medium=paid_social&utm_campaign=cmp_001&utm_content=cr_001`,
  );
});

test("the built URL is the URL that is checked, fragment included", () => {
  // The destination already sets the template's own parameter. The collision
  // is only visible in the built address, so the built address is what is
  // scanned.
  const evaluation = evaluate(fields(), sample(), `${BASE}?utm_source=facebook#tips`);
  assert.equal(ofKind(evaluation.findings, "duplicate_parameter").length, 1);
  assert.equal(duplicateParams(evaluation.preview.url).length, 1);
  assert.equal(rawParams(evaluation.preview.url).filter((pair) => pair.key === "utm_source").length, 2);
  assert.match(ofKind(evaluation.findings, "duplicate_parameter")[0].text, /because the sample ad's destination already sets it/);

  // A raw space in the anchor is a property of the address shown, so it is a
  // finding about the address shown.
  assert.equal(ofKind(urlFindings(`${BASE}#Q3 push`), "encoding").length, 1);
});

/* --------------------------------------------------------------- edit precedence --- */

test("the newest keystroke is the value the editor shows and resolves", () => {
  // Saved local draft `cpc`, then the operator types `email`.
  assert.equal(editorValueFrom("email", "cpc", "paid_social"), "email");
  // With no unsaved edit, the saved draft is the current value.
  assert.equal(editorValueFrom(undefined, "cpc", "paid_social"), "cpc");
  // With neither, the read's value is.
  assert.equal(editorValueFrom(undefined, undefined, "paid_social"), "paid_social");
  // An empty box the operator emptied is an edit, not an absence.
  assert.equal(editorValueFrom("", "cpc", "paid_social"), "");

  // The panel resolves the same value it displays.
  const typed = editorValueFrom("email", "cpc", "paid_social");
  const evaluation = evaluate([{ key: "utm_medium", label: "Medium", value: typed, required: true }], sample(), BASE);
  assert.equal(new URL(evaluation.preview.url).searchParams.get("utm_medium"), "email");
});

/* ---------------------------------------------------------- personal information --- */

test("an email address is personal information whether or not it is percent-encoded", () => {
  const escaped = `${BASE.replace("/survey", "/checklist")}?utm_content=lead%40example.invalid`;
  assert.equal(ofKind(urlFindings(escaped), "pii").length, 1);

  const written = evaluate([{ key: "utm_content", label: "Content", value: "lead%40example.invalid", required: true }], sample(), BASE);
  assert.equal(ofKind(written.findings, "pii").length, 1);

  // The plain form is still caught, so the decoded check did not replace the
  // raw one.
  assert.equal(ofKind(urlFindings(`${BASE.replace("/survey", "/checklist")}?utm_content=lead@example.invalid`), "pii").length, 1);

  // Long digit runs stay personal information. This is deliberately strict:
  // a number that is only an id still looks like a phone number or a customer
  // id once it is inside an analytics tool, and it cannot be taken back.
  assert.equal(ofKind(urlFindings(`${BASE}?utm_campaign=9999999999`), "pii").length, 1);
});

/* -------------------------------------------------------- shared tracking identity --- */

test("two ads that run one creative are told they share a tracking identity", () => {
  assert.equal(sharedIdentifier("{{creative.internal_id}}", "cr_001", 2), true);
  assert.equal(sharedIdentifier("{{creative.internal_id}}", "cr_001", 1), false);
  assert.equal(sharedIdentifier("{{ad.internal_id}}", "cr_001", 2), false);
  // A literal that happens to be the sampled creative id is the same collision.
  assert.equal(sharedIdentifier("cr_001", "cr_001", 2), true);

  const shared = evaluate(fields(), sample(), BASE, { sharedCreative: 2 });
  const warning = ofKind(shared.findings, "shared_identifier");
  assert.equal(warning.length, 1);
  assert.equal(warning[0].field, "utm_content");
  assert.equal(warning[0].severity, "warning");
  assert.match(warning[0].text, /2 ads in this read run that creative/);

  // One ad cannot collide with itself.
  assert.equal(ofKind(evaluate(fields(), sample(), BASE, { sharedCreative: 1 }).findings, "shared_identifier").length, 0);
});

/* ------------------------------------------------------------- identity and drafts --- */

test("an identity is the shared row key, and a draft belongs to one ad", () => {
  // `internalId` is the identity the rest of the workspace joins on; a
  // provider id in `id` is not `{{…internal_id}}`.
  const context = {
    campaign: { id: "9999999999", internalId: "cmp_001", name: "Always on 2" },
    creative: { id: "cr_001", internalId: "cr_int_1" },
    ad: { id: "111", internalId: "ad_int_1", name: "Survey — question" },
  };
  const map = sampleMap(context);
  assert.equal(map.get("campaign.internal_id"), "cmp_001");
  assert.equal(map.get("creative.internal_id"), "cr_int_1");
  assert.equal(map.get("ad.internal_id"), "ad_int_1");

  // A row with no provider id is still addressable.
  assert.equal(destinationDraftEntry(new Map(), { internalId: "ad_int_2", destination: "https://example.invalid/two" }).adId, "ad_int_2");

  const drafts = new Map();
  const first = { id: "111", internalId: "ad_int_1", destination: "https://example.invalid/one" };
  const second = { id: "222", internalId: "ad_int_2", destination: "https://example.invalid/two" };
  const one = destinationDraftEntry(drafts, first);
  one.value = "https://example.invalid/new-address";
  one.saved = { url: "https://example.invalid/new-address" };
  const two = destinationDraftEntry(drafts, second);
  assert.equal(two.saved, null);
  const back = destinationDraftEntry(drafts, first);
  assert.equal(back, one);
  assert.equal(back.saved.url, "https://example.invalid/new-address");
});

test("a placeholder with no sample is reported rather than left in the address silently", () => {
  const findings = evaluate([{ key: "utm_content", label: "Content", value: "{{ad.internal_id}}", required: true }], new Map(), BASE).findings;
  assert.equal(ofKind(findings, "unresolved_placeholder").length, 1);
  // The braces are syntax, not a mis-encoded value: no encoding noise on top.
  assert.equal(ofKind(findings, "encoding").length, 0);
});

/* ---------------------------------------------------------------------- guards --- */

test("a clean template produces no error findings", () => {
  const evaluation = evaluate(fields(), sample(), BASE);
  assert.equal(ofKind(evaluation.findings, "error").length, 0);
  assert.equal(evaluation.findings.filter((finding) => finding.severity === "error").length, 0);
  assert.equal(evaluation.preview.url, `${BASE}?utm_source=meta&utm_medium=paid_social&utm_campaign=cmp_001&utm_content=cr_001`);
});

test("an empty destination is not dressed up as a URL", () => {
  // With no destination the preview is the query string alone and the address
  // checks say nothing about a URL that does not exist; the destination is
  // checked where it is edited.
  const evaluation = evaluate(fields(), sample(), "");
  assert.equal(evaluation.preview.url, "utm_source=meta&utm_medium=paid_social&utm_campaign=cmp_001&utm_content=cr_001");
  assert.equal(ofKind(evaluation.findings, "invalid_url").length, 0);
});

test("one unencoded value is reported once", () => {
  // The per-value check and the address check must not both report the same
  // space; two sentences for one problem is the noise this file avoids.
  const evaluation = evaluate(
    [
      { key: "utm_source", label: "Source", value: "meta", required: true },
      { key: "utm_campaign", label: "Campaign", value: "Q3 push", required: true },
    ],
    sample(),
    BASE,
  );
  assert.equal(ofKind(evaluation.findings, "encoding").length, 1);

  const spaced = urlFindings(`${BASE}?utm_campaign=Q3 push`);
  assert.equal(ofKind(spaced, "encoding").length, 1);
  // The advice encodes the offending character, not a value that may already
  // carry a valid escape.
  assert.equal(ofKind(spaced, "encoding")[0].text.includes("%2520"), false);
  assert.match(ofKind(spaced, "encoding")[0].text, /Q3%20push/);
});
