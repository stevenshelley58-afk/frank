// Isolated preview fixtures for the Ads workspace.
//
// THE ONE RULE FOR THIS FILE: nothing here is real, and nothing here may be
// shown without the preview banner. These rows exist so the workflow can be
// rehearsed and reviewed before the reporting sync is wired. They are
// generated deterministically from a fixed seed, the account is named as a
// preview account, and every row carries `origin: "preview"`.
//
// The reader in `ads-source.js` returns these ONLY when the operator has turned
// preview on. The live path never falls back to this module.

import { isoDay } from "./ads-contracts.js";

const ORIGIN = "preview";
const ACCOUNT = Object.freeze({
  id: "act_preview_0000",
  name: "Preview account (sample data)",
  currency: "GBP",
  timezone: "Europe/London",
  origin: ORIGIN,
});

// A small deterministic PRNG so the same preview looks the same on every load.
// A preview that reshuffles on refresh makes it impossible to review a change.
function makeRandom(seed = 20260914) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length) % list.length];
}

function between(random, low, high) {
  return low + random() * (high - low);
}

function intBetween(random, low, high) {
  return Math.round(between(random, low, high));
}

// ---------------------------------------------------------------------------
// Vocabulary. These are *sample* concept names for a fictional advertiser, so
// they read as data rather than as claims about any real account.
// ---------------------------------------------------------------------------

const CONCEPTS = [
  "Cost of a missed call",
  "Same-day quote",
  "Before and after",
  "Founder explains the fee",
  "Three questions to ask",
  "What the quote excludes",
  "Seasonal check",
  "Customer story",
  "Myth versus reality",
  "Checklist download",
  "Price transparency",
  "Local coverage map",
];

const HOOKS = [
  "Question",
  "Statistic",
  "Direct address",
  "Contrarian claim",
  "Before/after",
  "Listicle",
  "Testimonial quote",
  "Price anchor",
];

const AUDIENCES = [
  "Homeowner, first purchase",
  "Homeowner, replacing",
  "Small landlord",
  "Property manager",
  "Comparison shopper",
  "Urgent fix",
];

const OFFERS = ["Free survey", "Fixed quote in 24h", "10% off first job", "No offer", "Free checklist"];

const FUNNEL_STAGES = ["Problem aware", "Solution aware", "Product aware", "Most aware"];

const FORMATS = ["Single image", "Carousel", "Short video", "Story", "Collection"];

const VISUAL_STYLES = [
  "Documentary photo",
  "Studio product",
  "Text on flat colour",
  "UGC handheld",
  "Diagram overlay",
  "Illustrated",
];

const SUBJECTS = [
  "Technician at a doorway",
  "Split-screen comparison",
  "Price card",
  "Map with pins",
  "Customer portrait",
  "Tool close-up",
  "Empty room, wide",
];

const COMPOSITIONS = ["Centred subject", "Left third text", "Full-bleed with lower third", "Grid of three", "Top-down flat lay"];

const CTAS = ["Get a quote", "Book a survey", "See prices", "Download the checklist", "Call now", "Learn more"];

const TOPICS = [
  "Cost guides",
  "How it works",
  "Maintenance",
  "Regulations",
  "Case studies",
  "Buying advice",
  "Seasonal",
];

const OBJECTIVES = ["Leads", "Sales", "Traffic", "Engagement", "Awareness"];
const OPTIMISATION_EVENTS = ["Lead", "Purchase", "Landing page view", "Link click", "Complete registration"];
const PLACEMENTS = ["Advantage+", "Feed only", "Feed + Stories", "Reels + Feed", "Manual"];

const ARTICLE_TITLES = [
  "What a survey actually covers",
  "The real cost of a same-day callout",
  "Five questions to ask before you book",
  "Why two quotes for the same job differ",
  "A homeowner's maintenance calendar",
  "What changed in the 2026 regulations",
  "How to read a quote line by line",
  "Choosing between repair and replace",
  "The deposit question, answered",
  "What happens on the day",
  "Seasonal checks worth paying for",
  "Case study: a 1930s terrace",
  "Comparing three quotes properly",
  "The paperwork you should keep",
];

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

function makeSeries(random, days, base, volatility) {
  const series = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  let level = base;
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(today.getTime() - i * 86400000);
    const weekday = date.getUTCDay();
    const weekend = weekday === 0 || weekday === 6 ? 0.72 : 1;
    level = Math.max(base * 0.25, level * (1 + between(random, -volatility, volatility)));
    // A couple of deliberately flat-and-then-broken stretches, so the trend
    // component has something real to draw rather than noise.
    const stall = i > days * 0.55 && i < days * 0.72 ? 0.45 : 1;
    series.push({
      date: isoDay(date),
      spend: Number((level * weekend * stall).toFixed(2)),
      impressions: Math.round(level * weekend * stall * between(random, 110, 150)),
      linkClicks: Math.round(level * weekend * stall * between(random, 2.2, 4.4)),
      results: Math.round(level * weekend * stall * between(random, 0.05, 0.16)),
      qualifiedLeads: random() > 0.72 ? intBetween(random, 0, 3) : 0,
    });
  }
  return series;
}

function sumSeries(series) {
  const total = { spend: 0, impressions: 0, linkClicks: 0, results: 0, qualifiedLeads: 0 };
  for (const point of series) {
    total.spend += point.spend;
    total.impressions += point.impressions;
    total.linkClicks += point.linkClicks;
    total.results += point.results;
    total.qualifiedLeads += point.qualifiedLeads;
  }
  return {
    spend: Number(total.spend.toFixed(2)),
    impressions: total.impressions,
    linkClicks: total.linkClicks,
    results: total.results,
    qualifiedLeads: total.qualifiedLeads,
    // Reach is provider-modelled and not additive across rows; the preview
    // approximates it from impressions so frequency stays plausible.
    reach: Math.round(total.impressions / betweenAlways(2.1)),
    landingViews: Math.round(total.linkClicks * 0.82),
  };
}

// Kept out of the random stream so totals stay stable for a given seed.
function betweenAlways(value) {
  return value;
}

function makeCreatives(random, count) {
  const creatives = [];
  for (let i = 0; i < count; i += 1) {
    const concept = pick(random, CONCEPTS);
    const hook = pick(random, HOOKS);
    const format = pick(random, FORMATS);
    const style = pick(random, VISUAL_STYLES);
    const id = `cr_${String(i + 1).padStart(4, "0")}`;
    const confidence = Number(between(random, 0.42, 0.97).toFixed(2));
    const corrected = random() > 0.82;
    const tags = [
      { field: "concept", value: concept, source: "prompt", confidence: Number(between(random, 0.72, 0.98).toFixed(2)) },
      { field: "hook", value: hook, source: "prompt", confidence: Number(between(random, 0.6, 0.95).toFixed(2)) },
      { field: "audience", value: pick(random, AUDIENCES), source: "prompt", confidence: Number(between(random, 0.5, 0.92).toFixed(2)) },
      { field: "offer", value: pick(random, OFFERS), source: "prompt", confidence: Number(between(random, 0.66, 0.98).toFixed(2)) },
      { field: "funnel_stage", value: pick(random, FUNNEL_STAGES), source: "prompt", confidence: Number(between(random, 0.45, 0.88).toFixed(2)) },
      { field: "format", value: format, source: "image", confidence: Number(between(random, 0.86, 0.99).toFixed(2)) },
      { field: "visual_style", value: style, source: "image", confidence: Number(between(random, 0.55, 0.94).toFixed(2)) },
      { field: "subject", value: pick(random, SUBJECTS), source: "image", confidence: Number(between(random, 0.5, 0.93).toFixed(2)) },
      { field: "composition", value: pick(random, COMPOSITIONS), source: "image", confidence: Number(between(random, 0.48, 0.9).toFixed(2)) },
      { field: "cta", value: pick(random, CTAS), source: "copy", confidence: Number(between(random, 0.7, 0.99).toFixed(2)) },
      { field: "blog_topic", value: pick(random, TOPICS), source: "copy", confidence: Number(between(random, 0.4, 0.86).toFixed(2)) },
    ];
    if (corrected) {
      const field = pick(random, ["concept", "hook", "blog_topic", "audience"]);
      const tag = tags.find((t) => t.field === field);
      tag.originalValue = tag.value;
      tag.value = field === "hook" ? pick(random, HOOKS) : field === "concept" ? pick(random, CONCEPTS) : pick(random, TOPICS);
      tag.source = "manual";
      tag.corrected = true;
      tag.confidence = 1;
    }
    // Roughly a quarter of the sample carries too little volume to rank. The
    // evidence floor then has something to refuse, which is the whole point of
    // rehearsing against fixtures.
    const lowVolume = random() > 0.74;
    const series = makeSeries(random, 28, lowVolume ? between(random, 0.6, 3.2) : between(random, 6, 46), lowVolume ? 0.4 : 0.09);
    const totals = sumSeries(series);
    creatives.push({
      origin: ORIGIN,
      id,
      internalId: id,
      name: `${concept} — ${hook.toLowerCase()}`,
      concept,
      hook,
      format,
      visual_style: style,
      audience: tags.find((t) => t.field === "audience").value,
      funnel_stage: tags.find((t) => t.field === "funnel_stage").value,
      blog_topic: tags.find((t) => t.field === "blog_topic").value,
      cta: tags.find((t) => t.field === "cta").value,
      state: "delivering",
      confidence,
      needsReview: confidence < 0.6 || corrected,
      corrected,
      tags,
      prompt: {
        text: `Editorial ${style.toLowerCase()} of ${pick(random, SUBJECTS).toLowerCase()}, ${pick(random, COMPOSITIONS).toLowerCase()}, ${format.toLowerCase()} crop, brand palette, no text overlay.`,
        model: random() > 0.5 ? "image-model v4.2" : "image-model v3.9",
        version: random() > 0.5 ? "v4.2" : "v3.9",
        capturedAt: isoDay(new Date(Date.now() - intBetween(random, 20, 300) * 86400000)),
      },
      lineage: {
        parentId: random() > 0.7 ? `cr_${String(intBetween(random, 1, Math.max(1, i))).padStart(4, "0")}` : null,
        generation: random() > 0.7 ? intBetween(random, 1, 3) : 0,
        packId: random() > 0.6 ? `pack_${intBetween(random, 1, 4)}` : null,
      },
      nearDuplicateOf: random() > 0.86 ? `cr_${String(intBetween(random, 1, Math.max(1, i))).padStart(4, "0")}` : null,
      preview: { ratio: format === "Story" ? "9:16" : random() > 0.5 ? "4:5" : "1:1", hasImage: true, hasVideo: format === "Short video" },
      series,
      totals,
    });
  }
  return creatives;
}

function makeHierarchy(random, size) {
  const scale = size === "large" ? { campaigns: 48, adsetsPer: 4, adsPer: 5 } : { campaigns: 7, adsetsPer: 2, adsPer: 3 };
  const creatives = makeCreatives(random, size === "large" ? 120 : 26);
  const campaigns = [];
  const adsets = [];
  const ads = [];
  let creativeCursor = 0;

  for (let c = 0; c < scale.campaigns; c += 1) {
    const objective = pick(random, OBJECTIVES);
    const event = objective === "Leads" ? "Lead" : objective === "Sales" ? "Purchase" : pick(random, OPTIMISATION_EVENTS);
    const id = `cmp_${String(c + 1).padStart(3, "0")}`;
    const lowVolume = random() > 0.78;
    const series = makeSeries(random, 28, lowVolume ? between(random, 1.2, 6) : between(random, 40, 320), lowVolume ? 0.45 : 0.1);
    const totals = sumSeries(series);
    const issues = [];
    if (random() > 0.82) issues.push(Object.freeze({ kind: "learning_limited", detail: "Ad set left the learning phase with fewer than 50 results." }));
    if (random() > 0.9) issues.push(Object.freeze({ kind: "frequency", detail: "Frequency above 3.4 — the same people are seeing this repeatedly." }));
    if (random() > 0.92) issues.push(Object.freeze({ kind: "tracking", detail: "Destination URL carries a duplicate utm_source parameter." }));
    campaigns.push({
      origin: ORIGIN,
      id,
      internalId: id,
      level: "campaign",
      name: `${objective} — ${pick(random, ["Always on", "Q3 push", "Retargeting", "New audience test", "Seasonal", "Brand"])} ${c + 1}`,
      status: random() > 0.86 ? "paused" : "delivering",
      state: random() > 0.94 ? "paused" : "delivering",
      objective,
      optimisation: event,
      budget: Number(between(random, 15, 240).toFixed(2)),
      budgetKind: random() > 0.5 ? "daily" : "lifetime",
      issues,
      series,
      totals,
      lastEdit: new Date(Date.now() - intBetween(random, 1, 400) * 3600000).toISOString(),
      parentId: null,
    });

    for (let s = 0; s < scale.adsetsPer; s += 1) {
      const sid = `${id}_set_${s + 1}`;
      const sSeries = makeSeries(random, 28, between(random, 12, 140), 0.12);
      const sTotals = sumSeries(sSeries);
      adsets.push({
        origin: ORIGIN,
        id: sid,
        internalId: sid,
        level: "adset",
        name: `${pick(random, ["Broad", "Lookalike 1%", "Retarget 30d", "Interest stack", "Local radius"])} ${s + 1}`,
        status: "delivering",
        state: "delivering",
        objective,
        optimisation: event,
        audience: pick(random, AUDIENCES),
        placements: pick(random, PLACEMENTS),
        budget: Number(between(random, 8, 90).toFixed(2)),
        budgetKind: "daily",
        schedule: "Continuous",
        issues: random() > 0.9 ? [Object.freeze({ kind: "audience_overlap", detail: "Overlaps another ad set in this campaign by an estimated 38%." })] : [],
        series: sSeries,
        totals: sTotals,
        parentId: id,
        lastEdit: new Date(Date.now() - intBetween(random, 1, 400) * 3600000).toISOString(),
      });

      for (let a = 0; a < scale.adsPer; a += 1) {
        const creative = creatives[creativeCursor % creatives.length];
        creativeCursor += 1;
        const aid = `${sid}_ad_${a + 1}`;
        const aSeries = makeSeries(random, 28, between(random, 4, 60), 0.14);
        const aTotals = sumSeries(aSeries);
        ads.push({
          origin: ORIGIN,
          id: aid,
          internalId: aid,
          level: "ad",
          name: `${creative.concept} — ${creative.hook}`,
          status: random() > 0.94 ? "rejected" : random() > 0.88 ? "paused" : "delivering",
          state: random() > 0.94 ? "rejected" : random() > 0.88 ? "paused" : "delivering",
          creativeId: creative.id,
          creativeName: creative.name,
          destination: `https://example.invalid/guides/${pick(random, ["survey", "costs", "regulations", "checklist"])}`,
          tracking: {
            utm_source: "meta",
            utm_medium: "paid_social",
            utm_campaign: `{{campaign.internal_id}}`,
            utm_content: creative.id,
            utm_term: null,
            internalId: `trk_${aid}`,
          },
          issues: random() > 0.93 ? [Object.freeze({ kind: "rejected", detail: "Rejected: text covering more than 20% of the image." })] : [],
          series: aSeries,
          totals: aTotals,
          parentId: sid,
          lastEdit: new Date(Date.now() - intBetween(random, 1, 600) * 3600000).toISOString(),
        });
      }
    }
  }
  return { campaigns, adsets, ads, creatives };
}

function makeBlogs(random, creatives) {
  return ARTICLE_TITLES.map((title, index) => {
    const topic = TOPICS[index % TOPICS.length];
    const paidSessions = intBetween(random, 40, 1400);
    const organicSessions = intBetween(random, 120, 5200);
    const siteSessions = paidSessions + organicSessions;
    const onwardClicks = Math.round(siteSessions * between(random, 0.04, 0.19));
    const engagedSessions = Math.round(siteSessions * between(random, 0.32, 0.74));
    const promoted = random() > 0.35;
    const spend = promoted ? Number(between(random, 40, 900).toFixed(2)) : 0;
    const qualifiedLeads = promoted ? intBetween(random, 0, 14) : intBetween(random, 0, 6);
    const creativeIds = creatives.filter((c) => c.blog_topic === topic).slice(0, 4).map((c) => c.id);
    return {
      origin: ORIGIN,
      id: `post_${String(index + 1).padStart(3, "0")}`,
      internalId: `post_${String(index + 1).padStart(3, "0")}`,
      name: title,
      topic,
      slug: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      publishedAt: isoDay(new Date(Date.now() - intBetween(random, 10, 700) * 86400000)),
      promoted,
      creativeIds,
      totals: {
        siteSessions,
        paidSessions,
        organicSessions,
        engagedSessions,
        onwardClicks,
        spend,
        siteConversions: intBetween(random, 0, 40),
        qualifiedLeads,
      },
      bySource: {
        organic: { siteSessions: organicSessions, onwardClicks: Math.round(onwardClicks * between(random, 0.4, 0.7)) },
        paid: { siteSessions: paidSessions, onwardClicks: Math.round(onwardClicks * between(random, 0.25, 0.5)) },
      },
    };
  });
}

function makeTracking() {
  return {
    templates: [
      {
        origin: ORIGIN,
        id: "tpl_standard",
        name: "Standard paid social",
        scope: "account",
        fields: [
          { key: "utm_source", value: "{{platform}}", required: true, note: "Lowercase platform key." },
          { key: "utm_medium", value: "paid_social", required: true, note: "Fixed." },
          { key: "utm_campaign", value: "{{campaign.internal_id}}", required: true, note: "Stable internal id, not the ad name." },
          { key: "utm_content", value: "{{creative.internal_id}}", required: true, note: "Stable creative id." },
          { key: "utm_term", value: "{{audience.key}}", required: false, note: "Optional." },
        ],
        updatedAt: new Date(Date.now() - 6 * 86400000).toISOString(),
        active: true,
      },
      {
        origin: ORIGIN,
        id: "tpl_blog",
        name: "Blog destination",
        scope: "project",
        fields: [
          { key: "utm_source", value: "meta", required: true },
          { key: "utm_medium", value: "paid_social", required: true },
          { key: "utm_campaign", value: "{{campaign.internal_id}}", required: true },
          { key: "utm_content", value: "{{ad.internal_id}}", required: true },
          { key: "utm_term", value: "", required: false },
        ],
        updatedAt: new Date(Date.now() - 21 * 86400000).toISOString(),
        active: true,
      },
      {
        origin: ORIGIN,
        id: "tpl_legacy",
        name: "Legacy (pre-2026 naming)",
        scope: "account",
        fields: [
          { key: "utm_source", value: "facebook", required: true },
          { key: "utm_medium", value: "cpc", required: true },
          { key: "utm_campaign", value: "{{campaign.name}}", required: true, note: "Uses the ad name — a rename breaks reporting." },
          { key: "utm_content", value: "{{ad.name}}", required: true },
          { key: "utm_term", value: "", required: false },
        ],
        updatedAt: new Date(Date.now() - 240 * 86400000).toISOString(),
        active: false,
      },
    ],
    validation: [
      {
        origin: ORIGIN,
        id: "val_1",
        severity: "warning",
        kind: "duplicate_parameter",
        adId: "cmp_001_set_1_ad_1",
        adName: "Cost of a missed call — question",
        detail: "utm_source appears twice. Most analytics tools keep the first value, so the second is silently ignored.",
        url: "https://example.invalid/guides/survey?utm_source=meta&utm_medium=paid_social&utm_source=facebook",
      },
      {
        origin: ORIGIN,
        id: "val_2",
        severity: "warning",
        kind: "unstable_identifier",
        adId: "cmp_002_set_1_ad_2",
        adName: "Same-day quote — statistic",
        detail: "Campaign value uses the ad name rather than a stable id. Renaming the campaign will split its history.",
        url: "https://example.invalid/guides/costs?utm_campaign=Leads+%E2%80%94+Always+on+2",
      },
      {
        origin: ORIGIN,
        id: "val_3",
        severity: "error",
        kind: "encoding",
        adId: "cmp_003_set_2_ad_1",
        adName: "Before and after — direct address",
        detail: "Unencoded space in utm_campaign. Some servers truncate the value at the space.",
        url: "https://example.invalid/guides/regulations?utm_campaign=Q3 push",
      },
      {
        origin: ORIGIN,
        id: "val_4",
        severity: "error",
        kind: "pii",
        adId: "cmp_004_set_1_ad_3",
        adName: "Founder explains the fee — listicle",
        detail: "An email address appears in utm_content. Personal information must never be placed in a tracking parameter.",
        url: "https://example.invalid/guides/checklist?utm_content=lead%40example.invalid",
      },
      {
        origin: ORIGIN,
        id: "val_5",
        severity: "info",
        kind: "missing_term",
        adId: "cmp_005_set_1_ad_1",
        adName: "Three questions to ask — question",
        detail: "No utm_term. Optional, but without it placement-level reporting falls back to the API only.",
        url: "https://example.invalid/guides/survey?utm_source=meta&utm_medium=paid_social",
      },
    ],
    history: [
      {
        origin: ORIGIN,
        id: "hist_1",
        at: new Date(Date.now() - 2 * 86400000).toISOString(),
        actor: "owner",
        adId: "cmp_001_set_1_ad_1",
        adName: "Cost of a missed call — question",
        change: "utm_content",
        before: "v1-hero",
        after: "cr_0001",
        note: "Switched to the stable creative id.",
      },
      {
        origin: ORIGIN,
        id: "hist_2",
        at: new Date(Date.now() - 9 * 86400000).toISOString(),
        actor: "sync",
        adId: "cmp_002_set_1_ad_2",
        adName: "Same-day quote — statistic",
        change: "destination",
        before: "https://example.invalid/guides/costs",
        after: "https://example.invalid/guides/costs?utm_source=meta",
        note: "Destination edited on the ad; the previous value is retained for the reporting join.",
      },
    ],
  };
}

function makeQueue(random, creatives) {
  const states = ["draft", "validated", "blocked", "queued", "uploading", "submitted", "in_review", "delivering", "paused", "rejected", "uncertain", "failed"];
  const batches = states.map((state, index) => {
    const rows = intBetween(random, 2, 18);
    const failures = state === "failed" || state === "rejected" || state === "uncertain" ? intBetween(random, 1, 3) : 0;
    return {
      origin: ORIGIN,
      id: `batch_${String(index + 1).padStart(3, "0")}`,
      internalId: `batch_${String(index + 1).padStart(3, "0")}`,
      name: `${pick(random, ["Launch", "Refresh", "Retarget", "Seasonal", "Evergreen"])} — ${pick(random, ["July", "August", "September", "Q3"])} pack ${index + 1}`,
      state,
      level: "ad",
      ads: rows,
      failures,
      attempts: state === "uncertain" ? 2 : state === "failed" ? 3 : 1,
      budgetDelta: Number(between(random, -40, 60).toFixed(2)),
      objective: pick(random, OBJECTIVES),
      optimisation: pick(random, OPTIMISATION_EVENTS),
      owner: pick(random, ["owner", "coordinator"]),
      updated: new Date(Date.now() - intBetween(random, 1, 200) * 3600000).toISOString(),
      created: new Date(Date.now() - intBetween(random, 20, 400) * 3600000).toISOString(),
      trackingTemplate: "Standard paid social",
      lastError: failures
        ? pick(random, [
            "Asset processing failed: image below the minimum 600px width.",
            "Duplicate ad detected — an identical creative is already in this ad set.",
            "Write accepted, delivery not confirmed. Reconcile before retrying.",
            "Rejected: landing page did not respond within the review window.",
          ])
        : "",
      creativeIds: creatives.slice(index % 5, (index % 5) + Math.min(rows, 6)).map((c) => c.id),
      rows: Array.from({ length: Math.min(rows, 8) }, (unused, r) => {
        const creative = creatives[(index * 3 + r) % creatives.length];
        const rowState = r < failures ? (state === "uncertain" ? "uncertain" : state === "rejected" ? "rejected" : "failed") : state === "delivering" ? "delivering" : state;
        return {
          origin: ORIGIN,
          id: `batch_${String(index + 1).padStart(3, "0")}_row_${r + 1}`,
          name: `${creative.concept} — ${creative.hook}`,
          creativeId: creative.id,
          state: rowState,
          attempts: rowState === "failed" ? 3 : 1,
          detail:
            rowState === "failed"
              ? "Asset rejected: image is 480px wide, the minimum is 600px."
              : rowState === "uncertain"
                ? "The write was accepted but delivery was never confirmed. Reconcile before retrying so a duplicate ad is not created."
                : rowState === "rejected"
                  ? "Rejected by review: text covers more than 20% of the image."
                  : "",
          destination: `https://example.invalid/guides/${pick(random, ["survey", "costs", "checklist"])}`,
          budget: Number(between(random, 8, 60).toFixed(2)),
          updated: new Date(Date.now() - intBetween(random, 1, 90) * 3600000).toISOString(),
        };
      }),
    };
  });

  const activity = [
    { origin: ORIGIN, id: "act_1", at: new Date(Date.now() - 40 * 60000).toISOString(), actor: "sync", kind: "queue", text: "Reconciled 2 uncertain writes: both ads exist and are delivering. No duplicate created." },
    { origin: ORIGIN, id: "act_2", at: new Date(Date.now() - 3 * 3600000).toISOString(), actor: "owner", kind: "budget", text: "Paused 4 ads in Launch — August pack 1, then restored 2 after the before/after review." },
    { origin: ORIGIN, id: "act_3", at: new Date(Date.now() - 26 * 3600000).toISOString(), actor: "sync", kind: "sync", text: "Incremental reporting sync completed. 28-day window re-fetched to capture delayed attribution." },
    { origin: ORIGIN, id: "act_4", at: new Date(Date.now() - 50 * 3600000).toISOString(), actor: "owner", kind: "queue", text: "Queued 12 ads across 3 ad sets. 11 submitted, 1 rejected on asset width." },
    { origin: ORIGIN, id: "act_5", at: new Date(Date.now() - 74 * 3600000).toISOString(), actor: "system", kind: "throttle", text: "Provider throttled a bulk read. Cached rows stayed visible; the request backed off and completed." },
  ];

  const changes = [
    { origin: ORIGIN, id: "chg_1", batchId: "batch_004", kind: "budget", from: "£24/day", to: "£32/day", state: "pending", requestedBy: "owner", at: new Date(Date.now() - 2 * 3600000).toISOString() },
    { origin: ORIGIN, id: "chg_2", batchId: "batch_008", kind: "pause", from: "delivering", to: "paused", state: "pending", requestedBy: "owner", at: new Date(Date.now() - 5 * 3600000).toISOString() },
  ];

  return { batches, activity, changes };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Build the whole preview dataset once per (seed, size) pair. */
function buildPreviewDataset({ seed = 20260914, size = "small" } = {}) {
  const random = makeRandom(seed);
  const { campaigns, adsets, ads, creatives } = makeHierarchy(random, size);
  const blogs = makeBlogs(random, creatives);
  const tracking = makeTracking();
  const queue = makeQueue(random, creatives);

  const rollup = (rows) => {
    const totals = { spend: 0, impressions: 0, linkClicks: 0, results: 0, qualifiedLeads: 0, reach: 0, landingViews: 0 };
    for (const row of rows) {
      if (!row.totals) continue;
      totals.spend += row.totals.spend || 0;
      totals.impressions += row.totals.impressions || 0;
      totals.linkClicks += row.totals.linkClicks || 0;
      totals.results += row.totals.results || 0;
      totals.qualifiedLeads += row.totals.qualifiedLeads || 0;
      totals.reach += row.totals.reach || 0;
      totals.landingViews += row.totals.landingViews || 0;
    }
    totals.spend = Number(totals.spend.toFixed(2));
    return totals;
  };

  // The account series is the day-wise sum, so the trend cannot disagree with
  // the table totals.
  const byDay = new Map();
  for (const campaign of campaigns) {
    for (const point of campaign.series) {
      const current = byDay.get(point.date) || { date: point.date, spend: 0, impressions: 0, linkClicks: 0, results: 0, qualifiedLeads: 0 };
      current.spend += point.spend;
      current.impressions += point.impressions;
      current.linkClicks += point.linkClicks;
      current.results += point.results;
      current.qualifiedLeads += point.qualifiedLeads;
      byDay.set(point.date, current);
    }
  }
  const series = Array.from(byDay.values())
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((point) => ({ ...point, spend: Number(point.spend.toFixed(2)) }));

  const totals = rollup(campaigns);
  const previous = {
    spend: Number((totals.spend * 0.92).toFixed(2)),
    impressions: Math.round(totals.impressions * 0.96),
    linkClicks: Math.round(totals.linkClicks * 0.88),
    results: Math.round(totals.results * 0.81),
    qualifiedLeads: Math.round(totals.qualifiedLeads * 0.74),
    reach: Math.round(totals.reach * 0.94),
    landingViews: Math.round((totals.landingViews || 0) * 0.9),
  };

  return Object.freeze({
    origin: ORIGIN,
    size,
    seed,
    account: ACCOUNT,
    context: {
      origin: ORIGIN,
      account: ACCOUNT,
      attribution: "7d_click_1d_view",
      sync: {
        status: "ready",
        lastSuccessAt: new Date(Date.now() - 42 * 60000).toISOString(),
        lagDays: 0,
        settleDays: 3,
        incremental: true,
        detail: "Incremental sync every 30 minutes for active campaigns, every 6 hours for historical.",
      },
      counts: { campaigns: campaigns.length, adsets: adsets.length, ads: ads.length, creatives: creatives.length },
    },
    overview: {
      origin: ORIGIN,
      totals,
      previous,
      series,
      attention: [
        ...campaigns
          .filter((c) => c.issues.length)
          .slice(0, 5)
          .map((c) => ({
            origin: ORIGIN,
            id: `att_${c.id}`,
            severity: c.issues[0].kind === "tracking" ? "warning" : "info",
            kind: c.issues[0].kind,
            title: c.name,
            detail: c.issues[0].detail,
            entityId: c.id,
            action: c.issues[0].kind === "tracking" ? "Open tracking" : "Open campaign",
          })),
        {
          origin: ORIGIN,
          id: "att_queue",
          severity: "error",
          kind: "queue",
          title: "2 uncertain writes waiting",
          detail: "These writes were accepted but delivery was never confirmed. Reconcile them before retrying so a duplicate ad is not created.",
          entityId: "batch_011",
          action: "Open queue",
        },
        {
          origin: ORIGIN,
          id: "att_evidence",
          severity: "info",
          kind: "evidence",
          title: "9 ads below the evidence floor",
          detail: "They have spend but too few results to rank. They are listed without a winner badge rather than being hidden.",
          entityId: null,
          action: "Open campaigns",
        },
      ],
    },
    entities: { campaigns, adsets, ads },
    creatives,
    blogs,
    tracking,
    queue,
  });
}

const CACHE = new Map();

function previewDataset(size = "small") {
  if (!CACHE.has(size)) CACHE.set(size, buildPreviewDataset({ size }));
  return CACHE.get(size);
}

/**
 * The preview adapter handed to `createAdsReader`. Mirrors the live envelope
 * exactly, and stamps every response so a caller cannot accidentally treat it
 * as live.
 */
export function createAdsPreview({ size = "small" } = {}) {
  let enabled = false;
  let currentSize = size;

  function rowsFor(reader, params) {
    const data = previewDataset(currentSize);
    const level = params?.level || "campaign";
    switch (reader) {
      case "context":
        return data.context;
      case "overview":
        return data.overview;
      case "entities":
        return { rows: data.entities[level === "adset" ? "adsets" : level === "ad" ? "ads" : "campaigns"], meta: { status: "ready", level } };
      case "creatives":
        return { rows: data.creatives, meta: { status: "ready" } };
      case "blogs":
        return { rows: data.blogs, meta: { status: "ready" } };
      case "tracking":
        return data.tracking;
      case "queue":
        return data.queue;
      default:
        return { rows: [], meta: { status: "empty" } };
    }
  }

  function envelopeFor(reader, params) {
    const payload = rowsFor(reader, params);
    const isRecord = !Array.isArray(payload) && !Array.isArray(payload?.rows);
    return Object.freeze({
      status: isRecord ? "ready" : payload.rows.length ? "ready" : "empty",
      data: isRecord ? { rows: null, meta: payload } : payload,
      detail: "",
      fetchedAt: Date.now(),
      origin: ORIGIN,
      cached: false,
      connected: true,
    });
  }

  return Object.freeze({
    enabled: () => enabled,
    setEnabled(value) {
      enabled = Boolean(value);
      return enabled;
    },
    size: () => currentSize,
    setSize(value) {
      currentSize = value === "large" ? "large" : "small";
      return currentSize;
    },
    dataset: () => previewDataset(currentSize),
    read(reader, params) {
      // A short delay keeps the loading states honest in rehearsal; without it
      // the skeleton path would never be exercised before the live wiring.
      return new Promise((resolve) => {
        setTimeout(() => resolve(envelopeFor(reader, params)), 140);
      });
    },
  });
}
