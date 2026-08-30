import test from "node:test";
import assert from "node:assert/strict";

import {
  guideChoiceAnswer,
  guideChooseForMeAnswer,
  guideOtherPrompt,
  normalizeGuideCard,
  normalizeGuideIntent,
} from "../web/mini/mini_guide.mjs";

function questionCard(overrides = {}) {
  return {
    schema: "mini-guide-v1",
    message: "I understand the goal. This choice will make the first version more useful.",
    understanding: [
      { key: "outcome", label: "Main goal", value: "Turn enquiries into bookings", assumed: false },
      { key: "people", label: "For", value: "Local homeowners", assumed: true },
    ],
    next: {
      kind: "question",
      id: "first-use",
      question: "What should happen first?",
      why: "This decides what customers see first.",
      options: [
        { id: "quote", label: "Ask for a quote", detail: "Collect the job details", recommended: true },
        { id: "book", label: "Book a time", detail: "Show available appointments", recommended: false },
      ],
      allow_other: true,
      allow_choose_for_me: true,
    },
    ...overrides,
  };
}

test("normalizes an exact bounded business question card and rejects arbitrary UI fields", () => {
  const raw = questionCard();
  raw.next.options.push(
    { id: "call", label: "Request a call", detail: "Take a phone number" },
    { id: "message", label: "Send a message", detail: "Open a short form" },
  );
  raw.next.options[2].recommended = false;
  raw.next.options[3].recommended = false;

  const card = normalizeGuideCard(raw);
  assert.equal(card.schema, "mini-guide-v1");
  assert.equal(card.next.options.length, 4);
  assert.equal(card.next.options[0].recommended, true);
  assert.equal(card.understanding[1].assumed, true);
  assert.equal(normalizeGuideCard({ ...raw, html: "<script>bad()</script>" }), null);
  const withUrl = structuredClone(raw);
  withUrl.next.options[0].url = "https://example.invalid";
  assert.equal(normalizeGuideCard(withUrl), null);
});

test("requires the versioned schema, a stable id and at least two choices", () => {
  assert.equal(normalizeGuideCard({ ...questionCard(), schema: "unknown" }), null);
  assert.equal(normalizeGuideCard(questionCard({ next: { ...questionCard().next, id: "bad id" } })), null);
  assert.equal(normalizeGuideCard(questionCard({ next: { ...questionCard().next, id: `a${"b".repeat(64)}` } })), null);
  assert.equal(normalizeGuideCard(questionCard({ next: { ...questionCard().next, options: [questionCard().next.options[0]] } })), null);
});

test("preview cards accept only fixed visual primitives and two or three options", () => {
  const preview = {
    kind: "page",
    title: "Perth Electrical Co.",
    subtitle: "Get a clear quote without waiting for a call",
    items: ["Your suburb", "Photos of the job", "Best time to visit"],
    action: "Ask for a quote",
  };
  const raw = questionCard({
    next: {
      kind: "preview",
      id: "first-look",
      question: "Which way of starting the quote feels clearer?",
      why: "Both use the same details, but guide customers differently.",
      options: [
        { id: "guided", label: "One question at a time", detail: "Calm and easy on a phone", recommended: true, preview },
        { id: "overview", label: "Everything on one page", detail: "Customers can scan ahead", recommended: false, preview: { ...preview, kind: "form" } },
        { id: "board", label: "Start from the job type", detail: "Show common jobs first", recommended: false, preview: { ...preview, kind: "board" } },
      ],
      allow_other: true,
      allow_choose_for_me: true,
    },
  });

  const card = normalizeGuideCard(raw);
  assert.equal(card.next.options.length, 3);
  assert.equal(card.next.options[0].preview.kind, "page");
  assert.deepEqual(Object.keys(card.next.options[0].preview), ["kind", "title", "subtitle", "items", "action"]);
  assert.equal(normalizeGuideCard(questionCard({ next: { ...raw.next, options: [{ ...raw.next.options[0], preview: { ...preview, kind: "video" } }, raw.next.options[1]] } })), null);
  assert.equal(normalizeGuideCard(questionCard({ next: { ...raw.next, options: [...raw.next.options, raw.next.options[0]] } })), null);
});

test("confirm cards carry the understood facts but no selectable options", () => {
  const card = normalizeGuideCard(questionCard({
    message: "Everything important is clear. Click Solve this for me — free.",
    next: {
      kind: "confirm",
      id: "ready",
      question: "",
      why: "The first version is clear and can still be changed for free.",
      options: [],
      allow_other: true,
      allow_choose_for_me: false,
    },
  }));
  assert.equal(card.next.kind, "confirm");
  assert.deepEqual(card.next.options, []);
  assert.equal(card.next.allow_other, true);
  assert.equal(card.next.allow_choose_for_me, false);
});

test("preserves all seven server-augmented facts, including assumption and direction", () => {
  const raw = questionCard();
  raw.understanding = [
    { key: "problem", label: "Problem", value: "Missed enquiries", assumed: false },
    { key: "outcome", label: "Outcome", value: "More booked work", assumed: false },
    { key: "people", label: "For", value: "Perth homeowners", assumed: false },
    { key: "current_way", label: "Today", value: "Phone calls", assumed: false },
    { key: "success", label: "Success", value: "Qualified bookings", assumed: false },
    { key: "assumption", label: "Best guess", value: "Mobile first", assumed: true },
    { key: "direction", label: "Direction", value: "Simple guided quote", assumed: true },
  ];
  const card = normalizeGuideCard(raw);
  assert.equal(card.understanding.length, 7);
  assert.deepEqual(card.understanding.slice(-2).map((fact) => fact.key), ["assumption", "direction"]);
});

test("rejects silent truncation, ambiguous recommendations and kind-specific field drift", () => {
  const sevenDurableFacts = questionCard();
  sevenDurableFacts.understanding = [
    { key: "problem", label: "Problem", value: "One", assumed: false },
    { key: "outcome", label: "Outcome", value: "Two", assumed: false },
    { key: "people", label: "People", value: "Three", assumed: false },
    { key: "current_way", label: "Today", value: "Four", assumed: false },
    { key: "success", label: "Success", value: "Five", assumed: false },
    { key: "assumption", label: "Assumption", value: "Six", assumed: true },
    { key: "direction", label: "Direction", value: "Seven", assumed: true },
  ];
  assert.equal(normalizeGuideCard(sevenDurableFacts).understanding.length, 7);
  const tooMuchUnderstanding = structuredClone(sevenDurableFacts);
  tooMuchUnderstanding.understanding.push({ key: "problem", label: "Problem", value: "Eight", assumed: true });
  assert.equal(normalizeGuideCard(tooMuchUnderstanding), null);

  const twoRecommendations = questionCard();
  twoRecommendations.next.options[1].recommended = true;
  assert.equal(normalizeGuideCard(twoRecommendations), null);

  const questionWithPreview = questionCard();
  questionWithPreview.next.options[0].preview = { kind: "form", title: "Quote", subtitle: "Fast details", items: ["Name", "Job"], action: "Continue" };
  assert.equal(normalizeGuideCard(questionWithPreview), null);

  const badConfirm = questionCard({
    message: "Everything is clear. Click Solve this for me — free.",
    next: { kind: "confirm", id: "ready", question: "Ready?", why: "", options: [], allow_other: true, allow_choose_for_me: false },
  });
  assert.equal(normalizeGuideCard(badConfirm), null);

  const tooManyMessageWords = questionCard({
    message: Array.from({ length: 46 }, () => "clear").join(" "),
  });
  assert.equal(normalizeGuideCard(tooManyMessageWords), null);

  const competingQuestion = questionCard();
  competingQuestion.next.why = "Not sure why? This would decide what customers see first.";
  assert.equal(normalizeGuideCard(competingQuestion), null);

  const technicalId = questionCard();
  technicalId.next.id = "backend_choice";
  assert.equal(normalizeGuideCard(technicalId), null);
});

test("turns a selected chip or default delegation into concise visible business language", () => {
  assert.deepEqual(guideChoiceAnswer(questionCard(), "quote"), {
    label: "Ask for a quote",
    text: "What should happen first: Ask for a quote.",
  });
  assert.deepEqual(guideChooseForMeAnswer(questionCard()), {
    label: "Frank will choose",
    text: "Please choose the best answer for me: What should happen first.",
  });
  assert.equal(guideOtherPrompt(questionCard()), "My answer to “What should happen first” is…");
  assert.equal(guideChoiceAnswer(questionCard(), "missing"), null);
});

test("normalizes only the four bounded guide intents", () => {
  for (const intent of ["choice", "other", "change", "choose_for_me"]) {
    assert.equal(normalizeGuideIntent(intent), intent);
  }
  assert.equal(normalizeGuideIntent("answer"), "choice");
  assert.equal(normalizeGuideIntent("unexpected", "change"), "change");
  assert.equal(normalizeGuideIntent("unexpected", "unexpected"), "choice");
});
