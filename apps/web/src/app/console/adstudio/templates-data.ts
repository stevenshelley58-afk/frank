// AUTO-GENERATED from Blockwise template-gallery/*.json (offline build output).
// Do not edit by hand — regenerate with scripts/build-demo-data.py.
// This file lives ONLY in the demo; the shipped package never imports it.

export type DemoBox = { x: number; y: number; width: number; height: number };

export type DemoTypeSpec = {
  fontId: string;
  family: string;
  fallbackFamily: "serif" | "sans-serif" | "monospace" | "cursive";
  weight: number;
  italic: boolean;
  case: "upper" | "lower" | "mixed" | "none";
  /** CSS font-size = (region box height px) * sizeRatio. */
  sizeRatio: number;
  lineHeight: number;
  tracking: number;
  align: "left" | "center" | "right";
  color: string;
  fitScore: number;
  sampleBox: DemoBox;
  sampleLineCount: number;
  detectionScore: number;
  fontFile?: string;
  /** v2 measurement metadata — present on manually-verified specs. */
  measurementVersion?: number;
  measurementSource?: string;
  measuredLines?: Array<{
    text: string;
    sampleBox: DemoBox;
    sizeRatio: number;
    scaleX?: number;
  }>;
};

export type DemoTextInput = { key: string; label: string; maxLength: number; sample: string; required: boolean };
export type DemoImageInput = { key: string; label: string; required: boolean; box?: DemoBox };

export type DemoTemplate = {
  id: string;
  name: string;
  format: "4:5" | "9:16";
  dimensions: { width: number; height: number };
  audienceIntent: string;
  category: string;
  tags: string[];
  sampleSrc: string;
  sourceFile: string;
  sourceHash: string;
  textInputs: DemoTextInput[];
  imageInputs: DemoImageInput[];
  typography: Record<string, DemoTypeSpec>;
  deterministicStatus: "partial" | "ready" | "none";
};

export const DEMO_TEMPLATES: DemoTemplate[] = [
  {
    "id": "meta-agent-intro-feed-037",
    "name": "Meet Your Local Agent \u2014 Feed 037",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Local property owners seeking a trusted agent relationship",
    "category": "agent-introduction-lead-generation",
    "tags": [
      "agent-intro",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-agent-intro-feed-037-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_037.png",
    "sourceHash": "c2b76dc1425b5c96c6b6845349f1dc2bfe1f0b390805daf46e00029347a97a7a",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 45,
        "sample": "YOUR LOCAL PROPERTY PARTNER",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 41,
        "sample": "BOOK A NO-PRESSURE CALL",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 95,
        "sample": "Local insight, clear advice and a practical plan for your next property move.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 29,
        "sample": "BOOK A CALL",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true,
        "box": {
          "x": 0.012037037037037037,
          "y": 0.01037037037037037,
          "width": 0.975925925925926,
          "height": 0.44074074074074077
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.7203703703703703,
          "y": 0.7503703703703704,
          "width": 0.2222222222222222,
          "height": 0.18074074074074073
        }
      }
    ],
    "typography": {
      "body": {
        "fontId": "poppins",
        "family": "Poppins",
        "fallbackFamily": "sans-serif",
        "weight": 500,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 0.9654835390946501,
        "lineHeight": 1.5,
        "tracking": 0,
        "align": "left",
        "color": "#46443c",
        "fitScore": 0.737,
        "sampleBox": {
          "x": 0.056018518518518516,
          "y": 0.8081481481481482,
          "width": 0.48055555555555557,
          "height": 0.08851851851851852
        },
        "sampleLineCount": 3,
        "detectionScore": 0.973,
        "fontFile": "/fonts/adstudio/poppins-500.woff2"
      },
      "headline": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2904374406906338,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "left",
        "color": "#302c1e",
        "fitScore": 0.624,
        "sampleBox": {
          "x": 0.05277777777777778,
          "y": 0.4714814814814815,
          "width": 0.7601851851851852,
          "height": 0.25074074074074076
        },
        "sampleLineCount": 3,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-600.woff2"
      },
      "subheadline": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2857142857142858,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "left",
        "color": "#c9a661",
        "fitScore": 0.449,
        "sampleBox": {
          "x": 0.056018518518518516,
          "y": 0.7544444444444445,
          "width": 0.586574074074074,
          "height": 0.024074074074074074
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-800.woff2"
      },
      "cta": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.309462915601023,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "left",
        "color": "#322e1b",
        "fitScore": 0.436,
        "sampleBox": {
          "x": 0.09305555555555556,
          "y": 0.9366666666666666,
          "width": 0.2388888888888889,
          "height": 0.021111111111111112
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-800.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-agent-intro-feed-051",
    "name": "Meet Your Local Agent \u2014 Feed 051",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Local property owners seeking a trusted agent relationship",
    "category": "agent-introduction-lead-generation",
    "tags": [
      "agent-intro",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-agent-intro-feed-051-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_051.png",
    "sourceHash": "86565ad6874566135bfabbac7c27b70fcd06b0cfe0c4378779f1d39448b188c5",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 45,
        "sample": "YOUR LOCAL PROPERTY PARTNER",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 41,
        "sample": "BOOK A NO-PRESSURE CALL",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 95,
        "sample": "Local insight, clear advice and a practical plan for your next property move.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 29,
        "sample": "BOOK A CALL",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 30,
        "sample": "0400 123 456",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true,
        "box": {
          "x": 0,
          "y": 0.24666666666666667,
          "width": 1,
          "height": 0.3940740740740741
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.08425925925925926,
          "y": 0.7985185185185185,
          "width": 0.1935185185185185,
          "height": 0.16074074074074074
        }
      }
    ],
    "typography": {
      "body": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.084745743857132,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#dfd1b6",
        "fitScore": 0.252,
        "sampleBox": {
          "x": 0.22870370370370371,
          "y": 0.6207407407407407,
          "width": 0.5912037037037037,
          "height": 0.1559259259259259
        },
        "sampleLineCount": 5,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/kanit-800.woff2"
      },
      "headline": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2030075187969924,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "center",
        "color": "#0b0b0b",
        "fitScore": 0.532,
        "sampleBox": {
          "x": 0.09074074074074075,
          "y": 0.08222222222222222,
          "width": 0.8439814814814814,
          "height": 0.10222222222222223
        },
        "sampleLineCount": 6,
        "detectionScore": 0.704,
        "fontFile": "/fonts/adstudio/oswald-300.woff2"
      },
      "subheadline": {
        "fontId": "titillium-web",
        "family": "Titillium Web",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.43256237006237,
        "lineHeight": 1.521,
        "tracking": 0,
        "align": "right",
        "color": "#dad6ce",
        "fitScore": 0.242,
        "sampleBox": {
          "x": 0.19074074074074074,
          "y": 0.20222222222222222,
          "width": 0.8092592592592592,
          "height": 0.06777777777777778
        },
        "sampleLineCount": 2,
        "detectionScore": 0.826,
        "fontFile": "/fonts/adstudio/titillium-web-900.woff2"
      },
      "phone": {
        "fontId": "roboto-slab",
        "family": "Roboto Slab",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.3582089552238805,
        "lineHeight": 1.31884765625,
        "tracking": 0,
        "align": "center",
        "color": "#243b42",
        "fitScore": 0.729,
        "sampleBox": {
          "x": 0.17407407407407408,
          "y": 0.8844444444444445,
          "width": 0.6689814814814815,
          "height": 0.05851851851851852
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/roboto-slab-800.woff2"
      },
      "cta": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5545193229000318,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "right",
        "color": "#2a2210",
        "fitScore": 0.596,
        "sampleBox": {
          "x": 0.2449074074074074,
          "y": 0.14962962962962964,
          "width": 0.687037037037037,
          "height": 0.10111111111111111
        },
        "sampleLineCount": 5,
        "detectionScore": 0.545,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-agent-intro-feed-131",
    "name": "Meet Your Local Agent \u2014 Feed 131",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Local property owners seeking a trusted agent relationship",
    "category": "agent-introduction-lead-generation",
    "tags": [
      "agent-intro",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-agent-intro-feed-131-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_131.png",
    "sourceHash": "d09b5fb2f23fcb6aa57e8726f3fab3b02123fbcb3e5a9831775e95537486398e",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 45,
        "sample": "YOUR LOCAL PROPERTY PARTNER",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 41,
        "sample": "BOOK A NO-PRESSURE CALL",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 95,
        "sample": "Local insight, clear advice and a practical plan for your next property move.",
        "required": true
      },
      {
        "key": "website",
        "label": "Website",
        "maxLength": 35,
        "sample": "youragency.com.au",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "rubik",
        "family": "Rubik",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0254768574096305,
        "lineHeight": 1.185,
        "tracking": 0,
        "align": "center",
        "color": "#918a7e",
        "fitScore": 0.287,
        "sampleBox": {
          "x": 0.09074074074074075,
          "y": 0.42518518518518517,
          "width": 0.8560185185185185,
          "height": 0.08
        },
        "sampleLineCount": 5,
        "detectionScore": 0.926,
        "fontFile": "/fonts/adstudio/rubik-700.woff2"
      },
      "headline": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.1851851698313578,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "center",
        "color": "#142c3a",
        "fitScore": 0.472,
        "sampleBox": {
          "x": 0.08564814814814815,
          "y": 0.20407407407407407,
          "width": 0.8657407407407407,
          "height": 0.1374074074074074
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-300.woff2"
      },
      "subheadline": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3181818181818181,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#a1732b",
        "fitScore": 0.436,
        "sampleBox": {
          "x": 0.0912037037037037,
          "y": 0.37333333333333335,
          "width": 0.4689814814814815,
          "height": 0.018518518518518517
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "website": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.1290322580645162,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#d5ad5f",
        "fitScore": 0.523,
        "sampleBox": {
          "x": 0.3314814814814815,
          "y": 0.9422222222222222,
          "width": 0.33796296296296297,
          "height": 0.022962962962962963
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-700.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-agent-intro-story-310",
    "name": "Meet Your Local Agent \u2014 Story 310",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Local property owners seeking a trusted agent relationship",
    "category": "agent-introduction-lead-generation",
    "tags": [
      "agent-intro",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-agent-intro-story-310-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_310.png",
    "sourceHash": "d57e9f8f071b1961ba9f429072f93b92a1f4d471f849fa5aac16c132816d98ea",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 45,
        "sample": "YOUR LOCAL PROPERTY PARTNER",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 41,
        "sample": "BOOK A NO-PRESSURE CALL",
        "required": true
      },
      {
        "key": "agent_name",
        "label": "Agent Name",
        "maxLength": 29,
        "sample": "ALEX MORGAN",
        "required": true
      },
      {
        "key": "agent_role",
        "label": "Agent Role",
        "maxLength": 43,
        "sample": "LOCAL PROPERTY SPECIALIST",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 95,
        "sample": "Local insight, clear advice and a practical plan for your next property move.",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 30,
        "sample": "0400 123 456",
        "required": true
      },
      {
        "key": "email",
        "label": "Email",
        "maxLength": 40,
        "sample": "alex@youragency.com.au",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 29,
        "sample": "BOOK A CALL",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0847457319069873,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#a29079",
        "fitScore": 0.469,
        "sampleBox": {
          "x": 0.05925925925925926,
          "y": 0.5145833333333333,
          "width": 0.9185185185185185,
          "height": 0.10598958333333333
        },
        "sampleLineCount": 12,
        "detectionScore": 0.667,
        "fontFile": "/fonts/adstudio/kanit-300.woff2"
      },
      "headline": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3493253373313343,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "left",
        "color": "#24384c",
        "fitScore": 0.429,
        "sampleBox": {
          "x": 0.13194444444444445,
          "y": 0.07578125,
          "width": 0.4981481481481482,
          "height": 0.013541666666666667
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-800.woff2"
      },
      "agent_role": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3354700854700854,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#28394e",
        "fitScore": 0.395,
        "sampleBox": {
          "x": 0.05740740740740741,
          "y": 0.36015625,
          "width": 0.34814814814814815,
          "height": 0.011197916666666667
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "subheadline": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.1851851434284126,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "left",
        "color": "#112a3e",
        "fitScore": 0.471,
        "sampleBox": {
          "x": 0.05925925925925926,
          "y": 0.13307291666666668,
          "width": 0.6736111111111112,
          "height": 0.11380208333333333
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-300.woff2"
      },
      "email": {
        "fontId": "roboto-condensed",
        "family": "Roboto Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 500,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.030073513031856,
        "lineHeight": 1.171875,
        "tracking": 0,
        "align": "left",
        "color": "#d2c7ad",
        "fitScore": 0.776,
        "sampleBox": {
          "x": 0.0587962962962963,
          "y": 0.7734375,
          "width": 0.4564814814814815,
          "height": 0.031510416666666666
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/roboto-condensed-500.woff2"
      },
      "phone": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.5594497215853258,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#dfca9e",
        "fitScore": 0.729,
        "sampleBox": {
          "x": 0.05925925925925926,
          "y": 0.72265625,
          "width": 0.287962962962963,
          "height": 0.03177083333333333
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-700.woff2"
      },
      "agent_name": {
        "fontId": "roboto-slab",
        "family": "Roboto Slab",
        "fallbackFamily": "serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3500986193293885,
        "lineHeight": 1.31884765625,
        "tracking": 0,
        "align": "left",
        "color": "#7c8894",
        "fitScore": 0.24,
        "sampleBox": {
          "x": 0.05787037037037037,
          "y": 0.32265625,
          "width": 0.2967592592592593,
          "height": 0.017447916666666667
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/roboto-slab-900.woff2"
      },
      "cta": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2682926829268293,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "center",
        "color": "#122939",
        "fitScore": 0.45,
        "sampleBox": {
          "x": 0.32037037037037036,
          "y": 0.8690104166666667,
          "width": 0.36435185185185187,
          "height": 0.02421875
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-700.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-appraisal-feed-002",
    "name": "Free Appraisal \u2014 Trusted Local Agent",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Homeowners considering selling or curious about their property's current value",
    "category": "appraisal-lead-generation",
    "tags": [
      "appraisal",
      "home-valuation",
      "seller-leads",
      "agent",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-appraisal-feed-002-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_002.png",
    "sourceHash": "a88fd2cb75d114774bd46f9b10bd1385583523054be384a437577e83e1fb2a26",
    "textInputs": [
      {
        "key": "trust_badge",
        "label": "Trust badge",
        "maxLength": 28,
        "sample": "YOUR LOCAL PROPERTY TEAM",
        "required": true
      },
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 38,
        "sample": "WHAT COULD YOUR HOME BE WORTH?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 30,
        "sample": "REQUEST A FREE APPRAISAL",
        "required": true
      },
      {
        "key": "body",
        "label": "Body copy",
        "maxLength": 150,
        "sample": "Get a clear, local view of your property's current market value and the opportunities available to you.",
        "required": true
      },
      {
        "key": "agent_name",
        "label": "Agent name",
        "maxLength": 32,
        "sample": "ALEX MORGAN",
        "required": true
      },
      {
        "key": "agent_role",
        "label": "Agent role",
        "maxLength": 32,
        "sample": "LOCAL PROPERTY SPECIALIST",
        "required": true
      },
      {
        "key": "email",
        "label": "Email",
        "maxLength": 44,
        "sample": "alex@youragency.com.au",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 20,
        "sample": "0400 123 456",
        "required": true
      },
      {
        "key": "social_handle",
        "label": "Social handle",
        "maxLength": 32,
        "sample": "@youragency",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true,
        "box": {
          "x": 0.012037037037037037,
          "y": 0.008148148148148147,
          "width": 0.975925925925926,
          "height": 0.42814814814814817
        }
      },
      {
        "key": "agent_portrait",
        "label": "Agent portrait",
        "required": true,
        "box": {
          "x": 0.7101851851851851,
          "y": 0.5925925925925926,
          "width": 0.2777777777777778,
          "height": 0.3985185185185185
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.7444444444444445,
          "y": 0.35333333333333333,
          "width": 0.2,
          "height": 0.16
        }
      }
    ],
    "typography": {
      "body": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.1094890510948905,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#574947",
        "fitScore": 0.647,
        "sampleBox": {
          "x": 0.09259259259259259,
          "y": 0.6862962962962963,
          "width": 0.8055555555555556,
          "height": 0.09777777777777778
        },
        "sampleLineCount": 4,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/kanit-800.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5520833333333333,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#28404e",
        "fitScore": 0.621,
        "sampleBox": {
          "x": 0.013888888888888888,
          "y": 0.5137037037037037,
          "width": 0.7902777777777777,
          "height": 0.09592592592592593
        },
        "sampleLineCount": 2,
        "detectionScore": 0.967,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "agent_role": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3392857142857144,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#b9a15b",
        "fitScore": 0.467,
        "sampleBox": {
          "x": 0.08333333333333333,
          "y": 0.947037037037037,
          "width": 0.2351851851851852,
          "height": 0.008518518518518519
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-900.woff2"
      },
      "trust_badge": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#f6f5f5",
        "fitScore": 0.095,
        "sampleBox": {
          "x": 0.17037037037037037,
          "y": 0.43037037037037035,
          "width": 0.7388888888888889,
          "height": 0.06481481481481481
        },
        "sampleLineCount": 4,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      },
      "subheadline": {
        "fontId": "quicksand",
        "family": "Quicksand",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.1220779220779218,
        "lineHeight": 1.25,
        "tracking": 0,
        "align": "left",
        "color": "#e7bd71",
        "fitScore": 0.679,
        "sampleBox": {
          "x": 0.09074074074074075,
          "y": 0.6577777777777778,
          "width": 0.5342592592592592,
          "height": 0.024074074074074074
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/quicksand-600.woff2"
      },
      "email": {
        "fontId": "open-sans",
        "family": "Open Sans",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.0496031746031746,
        "lineHeight": 1.36181640625,
        "tracking": 0,
        "align": "center",
        "color": "#bcc3c8",
        "fitScore": 0.584,
        "sampleBox": {
          "x": 0.4300925925925926,
          "y": 0.8792592592592593,
          "width": 0.2111111111111111,
          "height": 0.014444444444444444
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/open-sans-700.woff2"
      },
      "phone": {
        "fontId": "playfair-display",
        "family": "Playfair Display",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.121107266435986,
        "lineHeight": 1.333,
        "tracking": 0,
        "align": "center",
        "color": "#c7cdd1",
        "fitScore": 0.466,
        "sampleBox": {
          "x": 0.43148148148148147,
          "y": 0.9107407407407407,
          "width": 0.12037037037037036,
          "height": 0.01074074074074074
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/playfair-display-800.woff2"
      },
      "agent_name": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3351648351648353,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#dfe3e5",
        "fitScore": 0.46,
        "sampleBox": {
          "x": 0.08333333333333333,
          "y": 0.9207407407407407,
          "width": 0.23425925925925925,
          "height": 0.017037037037037038
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "social_handle": {
        "fontId": "roboto-condensed",
        "family": "Roboto Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.09297520661157,
        "lineHeight": 1.171875,
        "tracking": 0,
        "align": "center",
        "color": "#bac2c6",
        "fitScore": 0.542,
        "sampleBox": {
          "x": 0.4310185185185185,
          "y": 0.9418518518518518,
          "width": 0.11527777777777778,
          "height": 0.014444444444444444
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/roboto-condensed-700.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-appraisal-feed-082",
    "name": "Free Property Appraisal \u2014 Feed 082",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Homeowners curious about their current property value or considering selling",
    "category": "appraisal-lead-generation",
    "tags": [
      "appraisal",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-appraisal-feed-082-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_082.png",
    "sourceHash": "cb899a7ac26c2dd3bdd090f79c31178e5d30c1f01e66f1ae8e9a4b68a57db84a",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 48,
        "sample": "WHAT COULD YOUR HOME BE WORTH?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 42,
        "sample": "REQUEST A FREE APPRAISAL",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 69,
        "sample": "Get a clear local view of the current market value.",
        "required": true
      },
      {
        "key": "benefit_1",
        "label": "Benefit 1",
        "maxLength": 31,
        "sample": "LOCAL INSIGHT",
        "required": true
      },
      {
        "key": "benefit_2",
        "label": "Benefit 2",
        "maxLength": 31,
        "sample": "CURRENT VALUE",
        "required": true
      },
      {
        "key": "benefit_3",
        "label": "Benefit 3",
        "maxLength": 34,
        "sample": "CLEAR NEXT STEPS",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 37,
        "sample": "BOOK YOUR APPRAISAL",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.1666666666666667,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#454e57",
        "fitScore": 0.422,
        "sampleBox": {
          "x": 0.12407407407407407,
          "y": 0.8729629629629629,
          "width": 0.4305555555555556,
          "height": 0.012962962962962963
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238095473213118,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#42493f",
        "fitScore": 0.415,
        "sampleBox": {
          "x": 0.12083333333333333,
          "y": 0.67,
          "width": 0.44537037037037036,
          "height": 0.14333333333333334
        },
        "sampleLineCount": 3,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "heebo",
        "family": "Heebo",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2014285714285715,
        "lineHeight": 1.46875,
        "tracking": 0,
        "align": "left",
        "color": "#233644",
        "fitScore": 0.415,
        "sampleBox": {
          "x": 0.12407407407407407,
          "y": 0.8388888888888889,
          "width": 0.40185185185185185,
          "height": 0.018518518518518517
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/heebo-800.woff2"
      },
      "cta": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.4545454545454546,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#e2e4e6",
        "fitScore": 0.389,
        "sampleBox": {
          "x": 0.6569444444444444,
          "y": 0.822962962962963,
          "width": 0.19027777777777777,
          "height": 0.02074074074074074
        },
        "sampleLineCount": 1,
        "detectionScore": 0.474,
        "fontFile": "/fonts/adstudio/smooch-sans-800.woff2"
      },
      "benefit_3": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.52,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "right",
        "color": "#374a57",
        "fitScore": 0.562,
        "sampleBox": {
          "x": 0.7194444444444444,
          "y": 0.17333333333333334,
          "width": 0.20833333333333334,
          "height": 0.025185185185185185
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-600.woff2"
      },
      "benefit_1": {
        "fontId": "rubik",
        "family": "Rubik",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3777777777777778,
        "lineHeight": 1.185,
        "tracking": 0,
        "align": "left",
        "color": "#7dabd4",
        "fitScore": 0.491,
        "sampleBox": {
          "x": 0.4601851851851852,
          "y": 0.012222222222222223,
          "width": 0.42268518518518516,
          "height": 0.08037037037037037
        },
        "sampleLineCount": 3,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/rubik-900.woff2"
      },
      "benefit_2": {
        "fontId": "dm-sans",
        "family": "DM Sans",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.4325396825396828,
        "lineHeight": 1.302,
        "tracking": 0,
        "align": "left",
        "color": "#243c4f",
        "fitScore": 0.366,
        "sampleBox": {
          "x": 0.7356481481481482,
          "y": 0.1237037037037037,
          "width": 0.1574074074074074,
          "height": 0.011481481481481481
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/dm-sans-900.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-appraisal-feed-107",
    "name": "Free Property Appraisal \u2014 Feed 107",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Homeowners curious about their current property value or considering selling",
    "category": "appraisal-lead-generation",
    "tags": [
      "appraisal",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-appraisal-feed-107-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_107.png",
    "sourceHash": "7fba1baf734009ea335852da8014b00ac8a1137a881d35b0a19d64ec310ee04a",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 48,
        "sample": "WHAT COULD YOUR HOME BE WORTH?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 42,
        "sample": "REQUEST A FREE APPRAISAL",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 37,
        "sample": "BOOK YOUR APPRAISAL",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 30,
        "sample": "0400 123 456",
        "required": true
      },
      {
        "key": "social_handle",
        "label": "Social Handle",
        "maxLength": 29,
        "sample": "@youragency",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true,
        "box": {
          "x": 0.041666666666666664,
          "y": 0.037037037037037035,
          "width": 0.9166666666666666,
          "height": 0.4
        }
      }
    ],
    "typography": {
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238094995386595,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#686158",
        "fitScore": 0.489,
        "sampleBox": {
          "x": 0.1787037037037037,
          "y": 0.5388888888888889,
          "width": 0.6472222222222223,
          "height": 0.22407407407407406
        },
        "sampleLineCount": 3,
        "detectionScore": 0.906,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "nunito-sans",
        "family": "Nunito Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.0727040816326532,
        "lineHeight": 1.364,
        "tracking": 0,
        "align": "center",
        "color": "#42392e",
        "fitScore": 0.586,
        "sampleBox": {
          "x": 0.26805555555555555,
          "y": 0.8266666666666667,
          "width": 0.4824074074074074,
          "height": 0.018518518518518517
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/nunito-sans-800.woff2"
      },
      "cta": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.4545454545454546,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#e0dedb",
        "fitScore": 0.44,
        "sampleBox": {
          "x": 0.29907407407407405,
          "y": 0.8885185185185185,
          "width": 0.42407407407407405,
          "height": 0.021111111111111112
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-800.woff2"
      },
      "phone": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.3339371980676331,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "left",
        "color": "#443b30",
        "fitScore": 0.802,
        "sampleBox": {
          "x": 0.23055555555555557,
          "y": 0.9437037037037037,
          "width": 0.21574074074074073,
          "height": 0.030740740740740742
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-800.woff2"
      },
      "social_handle": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "left",
        "color": "#443c33",
        "fitScore": 0.653,
        "sampleBox": {
          "x": 0.6101851851851852,
          "y": 0.9522222222222222,
          "width": 0.14629629629629629,
          "height": 0.017777777777777778
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-700.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-appraisal-feed-144",
    "name": "Free Property Appraisal \u2014 Feed 144",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Homeowners curious about their current property value or considering selling",
    "category": "appraisal-lead-generation",
    "tags": [
      "appraisal",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-appraisal-feed-144-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_144.png",
    "sourceHash": "bf6ee11ffc548ce91bdf42183f4dc4edd1253f51266c1111fdd136ca610512ca",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 48,
        "sample": "WHAT COULD YOUR HOME BE WORTH?",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 69,
        "sample": "Get a clear local view of the current market value.",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 30,
        "sample": "0400 123 456",
        "required": true
      },
      {
        "key": "website",
        "label": "Website",
        "maxLength": 35,
        "sample": "youragency.com.au",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.2014285714285715,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#4e4a49",
        "fitScore": 0.466,
        "sampleBox": {
          "x": 0.07824074074074074,
          "y": 0.8425925925925926,
          "width": 0.6875,
          "height": 0.018518518518518517
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-700.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238095238095237,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#353131",
        "fitScore": 0.427,
        "sampleBox": {
          "x": 0.07037037037037037,
          "y": 0.5811111111111111,
          "width": 0.6796296296296296,
          "height": 0.2288888888888889
        },
        "sampleLineCount": 3,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "website": {
        "fontId": "lora",
        "family": "Lora",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.1322463768115942,
        "lineHeight": 1.28,
        "tracking": 0,
        "align": "right",
        "color": "#cecbca",
        "fitScore": 0.528,
        "sampleBox": {
          "x": 0.6847222222222222,
          "y": 0.9474074074074074,
          "width": 0.23703703703703705,
          "height": 0.015925925925925927
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/lora-700.woff2"
      },
      "phone": {
        "fontId": "playfair-display",
        "family": "Playfair Display",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.0813793103448277,
        "lineHeight": 1.333,
        "tracking": 0,
        "align": "left",
        "color": "#d5d2d0",
        "fitScore": 0.415,
        "sampleBox": {
          "x": 0.07824074074074074,
          "y": 0.9422222222222222,
          "width": 0.1865740740740741,
          "height": 0.017777777777777778
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/playfair-display-700.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-appraisal-feed-170",
    "name": "Free Property Appraisal \u2014 Feed 170",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Homeowners curious about their current property value or considering selling",
    "category": "appraisal-lead-generation",
    "tags": [
      "appraisal",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-appraisal-feed-170-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_170.png",
    "sourceHash": "c6e9860bd5ef6cf323e5c43180e1e481e1a97fc03ceec98f5db1c8b445fb96cc",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 48,
        "sample": "WHAT COULD YOUR HOME BE WORTH?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 42,
        "sample": "REQUEST A FREE APPRAISAL",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 37,
        "sample": "BOOK YOUR APPRAISAL",
        "required": true
      },
      {
        "key": "agent_name",
        "label": "Agent Name",
        "maxLength": 29,
        "sample": "ALEX MORGAN",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 30,
        "sample": "0400 123 456",
        "required": true
      },
      {
        "key": "email",
        "label": "Email",
        "maxLength": 40,
        "sample": "alex@youragency.com.au",
        "required": true
      },
      {
        "key": "address",
        "label": "Address",
        "maxLength": 33,
        "sample": "YOUR LOCAL AREA",
        "required": true
      },
      {
        "key": "website",
        "label": "Website",
        "maxLength": 35,
        "sample": "youragency.com.au",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "agent_portrait",
        "label": "Agent portrait",
        "required": true,
        "box": {
          "x": 0.54,
          "y": 0.26,
          "width": 0.46,
          "height": 0.74
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.575,
          "y": 0.817,
          "width": 0.137,
          "height": 0.115
        }
      }
    ],
    "typography": {
      "headline": {
        "fontId": "roboto-condensed",
        "family": "Roboto Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "measurementSource": "ocr-v2",
        "sizeRatio": 0.6818488943488944,
        "lineHeight": 1.171875,
        "tracking": 0,
        "align": "left",
        "color": "#0c1d27",
        "fitScore": 0.533,
        "sampleBox": {
          "x": 0.10092592592592593,
          "y": 0.16444444444444445,
          "width": 0.6699074074074074,
          "height": 0.12851851851851853
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "measuredLines": [
          {
            "text": "WHAT COULD YOUR",
            "sampleBox": {
              "x": 0.10092592592592593,
              "y": 0.16444444444444445,
              "width": 0.6699074074074074,
              "height": 0.05555555555555555
            },
            "sizeRatio": 1.577343775593776
          },
          {
            "text": "HOME BE WORTH?",
            "sampleBox": {
              "x": 0.10555555555555556,
              "y": 0.23814814814814814,
              "width": 0.600462962962963,
              "height": 0.054814814814814816
            },
            "sizeRatio": 1.5986592320207187
          }
        ],
        "fontFile": "/fonts/adstudio/roboto-condensed-800.woff2"
      },
      "subheadline": {
        "fontId": "dm-sans",
        "family": "DM Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "measurementSource": "ocr-v2",
        "sizeRatio": 1.2234169653524491,
        "lineHeight": 1.302,
        "tracking": 0,
        "align": "left",
        "color": "#262d30",
        "fitScore": 0.898,
        "sampleBox": {
          "x": 0.10601851851851851,
          "y": 0.327037037037037,
          "width": 0.4930555555555556,
          "height": 0.023703703703703703
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "measuredLines": [
          {
            "text": "REQUEST A FREE APPRAISAL",
            "sampleBox": {
              "x": 0.10601851851851851,
              "y": 0.327037037037037,
              "width": 0.4930555555555556,
              "height": 0.023703703703703703
            },
            "sizeRatio": 1.2234169653524491
          }
        ],
        "fontFile": "/fonts/adstudio/dm-sans-800.woff2"
      },
      "email": {
        "fontId": "big-shoulders",
        "family": "Big Shoulders",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "lower",
        "measurementVersion": 2,
        "measurementSource": "ocr-v2",
        "sizeRatio": 0.49594335819391255,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "right",
        "color": "#e5d6b9",
        "fitScore": 0.104,
        "sampleBox": {
          "x": 0.5916666666666667,
          "y": 0.8355555555555556,
          "width": 0.3449074074074074,
          "height": 0.11037037037037037
        },
        "sampleLineCount": 2,
        "detectionScore": 0.364,
        "measuredLines": [
          {
            "text": "ay a: MORGAN",
            "sampleBox": {
              "x": 0.5944444444444444,
              "y": 0.8355555555555556,
              "width": 0.3421296296296296,
              "height": 0.11037037037037037
            },
            "sizeRatio": 0.49594335819391255
          },
          {
            "text": "al",
            "sampleBox": {
              "x": 0.5916666666666667,
              "y": 0.8362962962962963,
              "width": 0.09259259259259259,
              "height": 0.06962962962962962
            },
            "sizeRatio": 0.7861229826690742
          }
        ],
        "fontFile": "/fonts/adstudio/big-shoulders-300.woff2"
      },
      "cta": {
        "fontId": "londrina-shadow",
        "family": "Londrina Shadow",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "measurementSource": "ocr-v2",
        "sizeRatio": 1.2821821036106749,
        "lineHeight": 1.183,
        "tracking": 0,
        "align": "left",
        "color": "#3d4043",
        "fitScore": 0.511,
        "sampleBox": {
          "x": 0.10185185185185185,
          "y": 0.40814814814814815,
          "width": 0.4736111111111111,
          "height": 0.03666666666666667
        },
        "sampleLineCount": 1,
        "detectionScore": 0.526,
        "measuredLines": [
          {
            "text": "BOOK AVFKALSAL",
            "sampleBox": {
              "x": 0.10185185185185185,
              "y": 0.40814814814814815,
              "width": 0.4736111111111111,
              "height": 0.03666666666666667
            },
            "sizeRatio": 1.2821821036106749
          }
        ],
        "fontFile": "/fonts/adstudio/londrina-shadow-400.woff2"
      },
      "agent_name": {
        "fontId": "roboto",
        "family": "Roboto",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "measurementSource": "ocr-v2",
        "sizeRatio": 0.6750493096646942,
        "lineHeight": 1.171875,
        "tracking": 0,
        "align": "right",
        "color": "#e1e3e5",
        "fitScore": 0.707,
        "sampleBox": {
          "x": 0.7342592592592593,
          "y": 0.847037037037037,
          "width": 0.20277777777777778,
          "height": 0.0637037037037037
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "measuredLines": [
          {
            "text": "ALEX",
            "sampleBox": {
              "x": 0.7342592592592593,
              "y": 0.847037037037037,
              "width": 0.11666666666666667,
              "height": 0.027037037037037037
            },
            "sizeRatio": 1.5905271405798276
          },
          {
            "text": "MORGAN",
            "sampleBox": {
              "x": 0.7356481481481482,
              "y": 0.882962962962963,
              "width": 0.2013888888888889,
              "height": 0.027777777777777776
            },
            "sizeRatio": 1.5481130834976988
          }
        ],
        "fontFile": "/fonts/adstudio/roboto-800.woff2"
      },
      "phone": {
        "fontId": "roboto-condensed",
        "family": "Roboto Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "mixed",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.55,
        "lineHeight": 1.2,
        "tracking": 0.01,
        "align": "center",
        "color": "#0c1d27",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.9,
          "width": 0.8,
          "height": 0.03
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/roboto-condensed-400.woff2"
      },
      "address": {
        "fontId": "roboto-condensed",
        "family": "Roboto Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.5,
        "lineHeight": 1.2,
        "tracking": 0.01,
        "align": "center",
        "color": "#0c1d27",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.93,
          "width": 0.8,
          "height": 0.03
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/roboto-condensed-400.woff2"
      },
      "website": {
        "fontId": "roboto-condensed",
        "family": "Roboto Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "lower",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.45,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#0c1d27",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.95,
          "width": 0.8,
          "height": 0.025
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/roboto-condensed-400.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-appraisal-feed-200",
    "name": "Free Property Appraisal \u2014 Feed 200",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Homeowners curious about their current property value or considering selling",
    "category": "appraisal-lead-generation",
    "tags": [
      "appraisal",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-appraisal-feed-200-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_200.png",
    "sourceHash": "9f7909390f4a5cd3168f80ae24d5dccd1ebf3ba852e6c67a2e5cd53cce88cc01",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 48,
        "sample": "WHAT COULD YOUR HOME BE WORTH?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 42,
        "sample": "REQUEST A FREE APPRAISAL",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 37,
        "sample": "BOOK YOUR APPRAISAL",
        "required": true
      },
      {
        "key": "agent_name",
        "label": "Agent Name",
        "maxLength": 29,
        "sample": "ALEX MORGAN",
        "required": true
      },
      {
        "key": "agent_role",
        "label": "Agent Role",
        "maxLength": 43,
        "sample": "LOCAL PROPERTY SPECIALIST",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 30,
        "sample": "0400 123 456",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true,
        "box": {
          "x": 0,
          "y": 0,
          "width": 1,
          "height": 0.43703703703703706
        }
      },
      {
        "key": "agent_portrait",
        "label": "Agent portrait",
        "required": true,
        "box": {
          "x": 0.1175925925925926,
          "y": 0.677037037037037,
          "width": 0.2962962962962963,
          "height": 0.27925925925925926
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.4722222222222222,
          "y": 0.6785185185185185,
          "width": 0.08888888888888889,
          "height": 0.06666666666666667
        }
      }
    ],
    "typography": {
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238094822652395,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#e3c793",
        "fitScore": 0.552,
        "sampleBox": {
          "x": 0.09074074074074075,
          "y": 0.4803703703703704,
          "width": 0.7930555555555555,
          "height": 0.11148148148148149
        },
        "sampleLineCount": 7,
        "detectionScore": 0.697,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "agent_role": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3529411764705883,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#cfd0d0",
        "fitScore": 0.408,
        "sampleBox": {
          "x": 0.475,
          "y": 0.812962962962963,
          "width": 0.3731481481481482,
          "height": 0.014444444444444444
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "subheadline": {
        "fontId": "lora",
        "family": "Lora",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.061524334251607,
        "lineHeight": 1.28,
        "tracking": 0,
        "align": "right",
        "color": "#d9d7d4",
        "fitScore": 0.866,
        "sampleBox": {
          "x": 0.4601851851851852,
          "y": 0.6155555555555555,
          "width": 0.4625,
          "height": 0.02259259259259259
        },
        "sampleLineCount": 2,
        "detectionScore": 0.625,
        "fontFile": "/fonts/adstudio/lora-700.woff2"
      },
      "cta": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.1932921447484555,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "left",
        "color": "#967751",
        "fitScore": 0.334,
        "sampleBox": {
          "x": 0.4634259259259259,
          "y": 0.12222222222222222,
          "width": 0.31851851851851853,
          "height": 0.06703703703703703
        },
        "sampleLineCount": 6,
        "detectionScore": 0.368,
        "fontFile": "/fonts/adstudio/oswald-700.woff2"
      },
      "phone": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.588235294117647,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#cdc2ae",
        "fitScore": 0.645,
        "sampleBox": {
          "x": 0.47314814814814815,
          "y": 0.8462962962962963,
          "width": 0.2518518518518518,
          "height": 0.035925925925925924
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-400.woff2"
      },
      "agent_name": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.300813008130081,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#e1e1e1",
        "fitScore": 0.583,
        "sampleBox": {
          "x": 0.47314814814814815,
          "y": 0.7670370370370371,
          "width": 0.33935185185185185,
          "height": 0.027037037037037037
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-600.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-appraisal-story-240",
    "name": "Free Property Appraisal \u2014 Story 240",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Homeowners curious about their current property value or considering selling",
    "category": "appraisal-lead-generation",
    "tags": [
      "appraisal",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-appraisal-story-240-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_240.png",
    "sourceHash": "d10fb48e8f4a19666c134e3a110b35fbc964388a462ab769a3ae48934473cd81",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 48,
        "sample": "WHAT COULD YOUR HOME BE WORTH?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 42,
        "sample": "REQUEST A FREE APPRAISAL",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 37,
        "sample": "BOOK YOUR APPRAISAL",
        "required": true
      },
      {
        "key": "website",
        "label": "Website",
        "maxLength": 35,
        "sample": "youragency.com.au",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "background_photo",
        "label": "Background photo",
        "required": true,
        "box": {
          "x": 0,
          "y": 0,
          "width": 1,
          "height": 1
        }
      }
    ],
    "typography": {
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238095334761623,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#f1f1f1",
        "fitScore": 0.482,
        "sampleBox": {
          "x": 0.26805555555555555,
          "y": 0.18567708333333333,
          "width": 0.5680555555555555,
          "height": 0.21354166666666666
        },
        "sampleLineCount": 4,
        "detectionScore": 0.897,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "open-sans",
        "family": "Open Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.125,
        "lineHeight": 1.36181640625,
        "tracking": 0,
        "align": "center",
        "color": "#dbdbdc",
        "fitScore": 0.635,
        "sampleBox": {
          "x": 0.24768518518518517,
          "y": 0.4270833333333333,
          "width": 0.5666666666666667,
          "height": 0.016927083333333332
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/open-sans-600.woff2"
      },
      "cta": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.4545454545454546,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#2a2b2e",
        "fitScore": 0.395,
        "sampleBox": {
          "x": 0.3199074074074074,
          "y": 0.490625,
          "width": 0.39305555555555555,
          "height": 0.01484375
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-800.woff2"
      },
      "website": {
        "fontId": "saira",
        "family": "Saira",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.3796926177878561,
        "lineHeight": 1.574,
        "tracking": 0,
        "align": "center",
        "color": "#78797b",
        "fitScore": 0.246,
        "sampleBox": {
          "x": 0.35694444444444445,
          "y": 0.55234375,
          "width": 0.3162037037037037,
          "height": 0.0125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/saira-900.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-appraisal-story-247",
    "name": "Free Appraisal \u2014 Book a Local Expert",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Local homeowners seeking a current property appraisal or preparing to sell",
    "category": "appraisal-lead-generation",
    "tags": [
      "appraisal",
      "home-valuation",
      "seller-leads",
      "agent",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-appraisal-story-247-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_247.png",
    "sourceHash": "5496237a4a523c9976cc7aabc1956f037ecff03e6151b8a17048a3a26662b563",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 38,
        "sample": "WHAT COULD YOUR HOME BE WORTH?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 30,
        "sample": "REQUEST A FREE APPRAISAL",
        "required": true
      },
      {
        "key": "body",
        "label": "Body copy",
        "maxLength": 150,
        "sample": "Get a clear, local view of your property's current market value and the opportunities available to you.",
        "required": true
      },
      {
        "key": "agent_name",
        "label": "Agent name",
        "maxLength": 32,
        "sample": "ALEX MORGAN",
        "required": true
      },
      {
        "key": "agent_role",
        "label": "Agent role",
        "maxLength": 32,
        "sample": "LOCAL PROPERTY SPECIALIST",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 20,
        "sample": "0400 123 456",
        "required": true
      },
      {
        "key": "email",
        "label": "Email",
        "maxLength": 44,
        "sample": "alex@youragency.com.au",
        "required": true
      },
      {
        "key": "website",
        "label": "Website",
        "maxLength": 38,
        "sample": "youragency.com.au",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "agent_portrait",
        "label": "Agent portrait",
        "required": true,
        "box": {
          "x": 0,
          "y": 0,
          "width": 1,
          "height": 0.4578125
        }
      }
    ],
    "typography": {
      "body": {
        "fontId": "quicksand",
        "family": "Quicksand",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.069675098684979,
        "lineHeight": 1.25,
        "tracking": 0,
        "align": "left",
        "color": "#90918f",
        "fitScore": 0.541,
        "sampleBox": {
          "x": 0.09166666666666666,
          "y": 0.6776041666666667,
          "width": 0.5893518518518519,
          "height": 0.096875
        },
        "sampleLineCount": 5,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/quicksand-300.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238095326526355,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#f2f3f3",
        "fitScore": 0.478,
        "sampleBox": {
          "x": 0.09074074074074075,
          "y": 0.45546875,
          "width": 0.6226851851851852,
          "height": 0.22135416666666666
        },
        "sampleLineCount": 3,
        "detectionScore": 0.828,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "agent_role": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3230490018148817,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "left",
        "color": "#cfd0d2",
        "fitScore": 0.487,
        "sampleBox": {
          "x": 0.09259259259259259,
          "y": 0.85703125,
          "width": 0.45416666666666666,
          "height": 0.011979166666666667
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-700.woff2"
      },
      "subheadline": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2007142857142858,
        "lineHeight": 1.424,
        "tracking": 0,
        "align": "center",
        "color": "#e1c709",
        "fitScore": 0.581,
        "sampleBox": {
          "x": 0.09444444444444444,
          "y": 0.6653645833333334,
          "width": 0.7064814814814815,
          "height": 0.01953125
        },
        "sampleLineCount": 1,
        "detectionScore": 1
      },
      "email": {
        "fontId": "lora",
        "family": "Lora",
        "fallbackFamily": "serif",
        "weight": 600,
        "italic": false,
        "case": "lower",
        "sizeRatio": 0.9473684210526314,
        "lineHeight": 1.28,
        "tracking": 0,
        "align": "left",
        "color": "#bdbec0",
        "fitScore": 0.647,
        "sampleBox": {
          "x": 0.1310185185185185,
          "y": 0.9203125,
          "width": 0.3560185185185185,
          "height": 0.016666666666666666
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/lora-600.woff2"
      },
      "website": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.1153846153846154,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#c1c3c5",
        "fitScore": 0.509,
        "sampleBox": {
          "x": 0.16064814814814815,
          "y": 0.95390625,
          "width": 0.24675925925925926,
          "height": 0.013020833333333334
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-700.woff2"
      },
      "phone": {
        "fontId": "raleway",
        "family": "Raleway",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.215,
        "lineHeight": 1.174,
        "tracking": 0,
        "align": "left",
        "color": "#cacccd",
        "fitScore": 0.484,
        "sampleBox": {
          "x": 0.16064814814814815,
          "y": 0.8924479166666667,
          "width": 0.17314814814814813,
          "height": 0.012239583333333333
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/raleway-700.woff2"
      },
      "agent_name": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.500709219858156,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#e2c607",
        "fitScore": 0.53,
        "sampleBox": {
          "x": 0.0912037037037037,
          "y": 0.821875,
          "width": 0.3912037037037037,
          "height": 0.02109375
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-600.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-appraisal-story-258",
    "name": "Free Property Appraisal \u2014 Story 258",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Homeowners curious about their current property value or considering selling",
    "category": "appraisal-lead-generation",
    "tags": [
      "appraisal",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-appraisal-story-258-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_258.png",
    "sourceHash": "aa774410d6d77c2502190f6a80603ad425fdbbd05ce1cca4c815fe8709f445c9",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 48,
        "sample": "WHAT COULD YOUR HOME BE WORTH?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 42,
        "sample": "REQUEST A FREE APPRAISAL",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 69,
        "sample": "Get a clear local view of the current market value.",
        "required": true
      },
      {
        "key": "agent_name",
        "label": "Agent Name",
        "maxLength": 29,
        "sample": "ALEX MORGAN",
        "required": true
      },
      {
        "key": "agent_role",
        "label": "Agent Role",
        "maxLength": 43,
        "sample": "LOCAL PROPERTY SPECIALIST",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 37,
        "sample": "BOOK YOUR APPRAISAL",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "background_photo",
        "label": "Background photo",
        "required": true
      },
      {
        "key": "agent_portrait",
        "label": "Agent portrait",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "quicksand",
        "family": "Quicksand",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.3381796153263668,
        "lineHeight": 1.25,
        "tracking": 0,
        "align": "center",
        "color": "#444754",
        "fitScore": 0.555,
        "sampleBox": {
          "x": 0.300462962962963,
          "y": 0.7322916666666667,
          "width": 0.4064814814814815,
          "height": 0.04296875
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/quicksand-300.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238095838244292,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#172035",
        "fitScore": 0.537,
        "sampleBox": {
          "x": 0.07314814814814814,
          "y": 0.48385416666666664,
          "width": 0.9268518518518518,
          "height": 0.15286458333333333
        },
        "sampleLineCount": 5,
        "detectionScore": 0.853,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "agent_role": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.391304347826087,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#3e4151",
        "fitScore": 0.536,
        "sampleBox": {
          "x": 0.25,
          "y": 0.865625,
          "width": 0.49953703703703706,
          "height": 0.010677083333333334
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "subheadline": {
        "fontId": "pt-sans",
        "family": "PT Sans",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.1142857142857143,
        "lineHeight": 1.294,
        "tracking": 0,
        "align": "center",
        "color": "#ad8a59",
        "fitScore": 0.562,
        "sampleBox": {
          "x": 0.19537037037037036,
          "y": 0.69140625,
          "width": 0.6189814814814815,
          "height": 0.018489583333333334
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/pt-sans-700.woff2"
      },
      "agent_name": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2767462422634834,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#182036",
        "fitScore": 0.562,
        "sampleBox": {
          "x": 0.3060185185185185,
          "y": 0.8299479166666667,
          "width": 0.3958333333333333,
          "height": 0.01796875
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "cta": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.65,
        "lineHeight": 1.2,
        "tracking": 0.02,
        "align": "center",
        "color": "#444754",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.78,
          "width": 0.8,
          "height": 0.05
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/merriweather-300.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-appraisal-story-300",
    "name": "Free Property Appraisal \u2014 Story 300",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Homeowners curious about their current property value or considering selling",
    "category": "appraisal-lead-generation",
    "tags": [
      "appraisal",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-appraisal-story-300-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_300.png",
    "sourceHash": "c06d8aa44031b6a7c133187fbeadca33890c20b3a6dbbe1fd7768943c179f8e2",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 48,
        "sample": "WHAT COULD YOUR HOME BE WORTH?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 42,
        "sample": "REQUEST A FREE APPRAISAL",
        "required": true
      },
      {
        "key": "agent_name",
        "label": "Agent Name",
        "maxLength": 29,
        "sample": "ALEX MORGAN",
        "required": true
      },
      {
        "key": "agent_role",
        "label": "Agent Role",
        "maxLength": 43,
        "sample": "LOCAL PROPERTY SPECIALIST",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 30,
        "sample": "0400 123 456",
        "required": true
      },
      {
        "key": "email",
        "label": "Email",
        "maxLength": 40,
        "sample": "alex@youragency.com.au",
        "required": true
      },
      {
        "key": "website",
        "label": "Website",
        "maxLength": 35,
        "sample": "youragency.com.au",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "agent_portrait",
        "label": "Agent portrait",
        "required": true
      }
    ],
    "typography": {
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.523809621999936,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#252322",
        "fitScore": 0.518,
        "sampleBox": {
          "x": 0.08981481481481482,
          "y": 0.13723958333333333,
          "width": 0.549537037037037,
          "height": 0.13359375
        },
        "sampleLineCount": 9,
        "detectionScore": 0.707,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "agent_role": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3529411764705883,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#4d4b46",
        "fitScore": 0.455,
        "sampleBox": {
          "x": 0.09768518518518518,
          "y": 0.7932291666666667,
          "width": 0.44351851851851853,
          "height": 0.01015625
        },
        "sampleLineCount": 1,
        "detectionScore": 0.88,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "subheadline": {
        "fontId": "lora",
        "family": "Lora",
        "fallbackFamily": "serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.061524334251607,
        "lineHeight": 1.28,
        "tracking": 0,
        "align": "left",
        "color": "#42413d",
        "fitScore": 0.752,
        "sampleBox": {
          "x": 0.09814814814814815,
          "y": 0.28984375,
          "width": 0.524074074074074,
          "height": 0.015625
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/lora-600.woff2"
      },
      "email": {
        "fontId": "roboto-condensed",
        "family": "Roboto Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.0347800237812128,
        "lineHeight": 1.171875,
        "tracking": 0,
        "align": "left",
        "color": "#6e6b65",
        "fitScore": 0.871,
        "sampleBox": {
          "x": 0.09166666666666666,
          "y": 0.86484375,
          "width": 0.48518518518518516,
          "height": 0.0265625
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/roboto-condensed-400.woff2"
      },
      "website": {
        "fontId": "lora",
        "family": "Lora",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.0833333333333333,
        "lineHeight": 1.28,
        "tracking": 0,
        "align": "left",
        "color": "#474541",
        "fitScore": 0.669,
        "sampleBox": {
          "x": 0.16574074074074074,
          "y": 0.90546875,
          "width": 0.3106481481481482,
          "height": 0.011458333333333333
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/lora-700.woff2"
      },
      "phone": {
        "fontId": "raleway",
        "family": "Raleway",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.1768086544962812,
        "lineHeight": 1.174,
        "tracking": 0,
        "align": "left",
        "color": "#696661",
        "fitScore": 0.75,
        "sampleBox": {
          "x": 0.09166666666666666,
          "y": 0.834375,
          "width": 0.30092592592592593,
          "height": 0.0265625
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/raleway-400.woff2"
      },
      "agent_name": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 500,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5162907268170427,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#242321",
        "fitScore": 0.681,
        "sampleBox": {
          "x": 0.09212962962962963,
          "y": 0.75,
          "width": 0.4824074074074074,
          "height": 0.025520833333333333
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-500.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-buyers-wanted-feed-126",
    "name": "Active Buyers Wanted \u2014 Feed 126",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Homeowners who may sell when matched with active local buyers",
    "category": "buyer-demand-lead-generation",
    "tags": [
      "buyers-wanted",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-buyers-wanted-feed-126-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_126.png",
    "sourceHash": "13fcf5af5be5ebaeb1936dc52c3c060abad2065ae88bb39026a5d7a55fc2eace",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 53,
        "sample": "ACTIVE BUYERS WANT HOMES LIKE YOURS",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 46,
        "sample": "SEE IF YOUR PROPERTY MATCHES",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 77,
        "sample": "We are speaking with qualified buyers looking in your area.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 36,
        "sample": "CHECK BUYER DEMAND",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0333333333333334,
        "lineHeight": 1.424,
        "tracking": 0,
        "align": "left",
        "color": "#363f50",
        "fitScore": 0.542,
        "sampleBox": {
          "x": 0.0912037037037037,
          "y": 0.8051851851851852,
          "width": 0.33055555555555555,
          "height": 0.08
        },
        "sampleLineCount": 3,
        "detectionScore": 1
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238095498373094,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#0c2035",
        "fitScore": 0.456,
        "sampleBox": {
          "x": 0.08425925925925926,
          "y": 0.5037037037037037,
          "width": 0.7921296296296296,
          "height": 0.21407407407407408
        },
        "sampleLineCount": 3,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2857142857142858,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "left",
        "color": "#e7b44c",
        "fitScore": 0.48,
        "sampleBox": {
          "x": 0.09027777777777778,
          "y": 0.7474074074074074,
          "width": 0.6555555555555556,
          "height": 0.023703703703703703
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-700.woff2"
      },
      "cta": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.65,
        "lineHeight": 1.2,
        "tracking": 0.02,
        "align": "center",
        "color": "#363f50",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.78,
          "width": 0.8,
          "height": 0.05
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-buyers-wanted-feed-191",
    "name": "Active Buyers Wanted \u2014 Feed 191",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Homeowners who may sell when matched with active local buyers",
    "category": "buyer-demand-lead-generation",
    "tags": [
      "buyers-wanted",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-buyers-wanted-feed-191-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_191.png",
    "sourceHash": "4f3fd9b46206cf815a3a5750ac1e3d26cc81cd9bba6f0f6f3821e5cad816ad5c",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 53,
        "sample": "ACTIVE BUYERS WANT HOMES LIKE YOURS",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 46,
        "sample": "SEE IF YOUR PROPERTY MATCHES",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 77,
        "sample": "We are speaking with qualified buyers looking in your area.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 36,
        "sample": "CHECK BUYER DEMAND",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0705882352941176,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "right",
        "color": "#b2b5b6",
        "fitScore": 0.222,
        "sampleBox": {
          "x": 0.21388888888888888,
          "y": 0.35518518518518516,
          "width": 0.774537037037037,
          "height": 0.1174074074074074
        },
        "sampleLineCount": 8,
        "detectionScore": 0.829,
        "fontFile": "/fonts/adstudio/kanit-700.woff2"
      },
      "headline": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2076923076923076,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "center",
        "color": "#0e2136",
        "fitScore": 0.516,
        "sampleBox": {
          "x": 0.08657407407407407,
          "y": 0.17851851851851852,
          "width": 0.8300925925925926,
          "height": 0.10185185185185185
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-300.woff2"
      },
      "subheadline": {
        "fontId": "barlow-condensed",
        "family": "Barlow Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3617021660378668,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#7f8783",
        "fitScore": 0.23,
        "sampleBox": {
          "x": 0.11064814814814815,
          "y": 0.2651851851851852,
          "width": 0.7111111111111111,
          "height": 0.14148148148148149
        },
        "sampleLineCount": 3,
        "detectionScore": 0.643,
        "fontFile": "/fonts/adstudio/barlow-condensed-800.woff2"
      },
      "cta": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.65,
        "lineHeight": 1.2,
        "tracking": 0.02,
        "align": "center",
        "color": "#b2b5b6",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.78,
          "width": 0.8,
          "height": 0.05
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/kanit-300.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-buyers-wanted-feed-192",
    "name": "Active Buyers Wanted \u2014 Feed 192",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Homeowners who may sell when matched with active local buyers",
    "category": "buyer-demand-lead-generation",
    "tags": [
      "buyers-wanted",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-buyers-wanted-feed-192-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_192.png",
    "sourceHash": "3622fe6198b9b09421b46326fe90740bd6b6a5570881338034c7cce47a62d74a",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 53,
        "sample": "ACTIVE BUYERS WANT HOMES LIKE YOURS",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 46,
        "sample": "SEE IF YOUR PROPERTY MATCHES",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 77,
        "sample": "We are speaking with qualified buyers looking in your area.",
        "required": true
      },
      {
        "key": "benefit_1",
        "label": "Benefit 1",
        "maxLength": 34,
        "sample": "QUALIFIED BUYERS",
        "required": true
      },
      {
        "key": "benefit_2",
        "label": "Benefit 2",
        "maxLength": 30,
        "sample": "LOCAL DEMAND",
        "required": true
      },
      {
        "key": "benefit_3",
        "label": "Benefit 3",
        "maxLength": 34,
        "sample": "NO-PRESSURE CHAT",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 36,
        "sample": "CHECK BUYER DEMAND",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true,
        "box": {
          "x": 0,
          "y": 0,
          "width": 1,
          "height": 1
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.8027777777777778,
          "y": 0.04962962962962963,
          "width": 0.13333333333333333,
          "height": 0.10666666666666667
        }
      }
    ],
    "typography": {
      "body": {
        "fontId": "jost",
        "family": "Jost",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 0.9846311475409837,
        "lineHeight": 1.445,
        "tracking": 0,
        "align": "left",
        "color": "#afb2b9",
        "fitScore": 0.655,
        "sampleBox": {
          "x": 0.08055555555555556,
          "y": 0.35185185185185186,
          "width": 0.39166666666666666,
          "height": 0.04
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/jost-300.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.523809503437309,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#f5f4f4",
        "fitScore": 0.498,
        "sampleBox": {
          "x": 0.07546296296296297,
          "y": 0.06666666666666667,
          "width": 0.7972222222222223,
          "height": 0.20555555555555555
        },
        "sampleLineCount": 4,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5417122040072857,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#dfad58",
        "fitScore": 0.822,
        "sampleBox": {
          "x": 0.08101851851851852,
          "y": 0.27185185185185184,
          "width": 0.49212962962962964,
          "height": 0.05925925925925926
        },
        "sampleLineCount": 4,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "cta": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2931616961789376,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "center",
        "color": "#7f7133",
        "fitScore": 0.223,
        "sampleBox": {
          "x": 0.2875,
          "y": 0.8381481481481482,
          "width": 0.43472222222222223,
          "height": 0.09555555555555556
        },
        "sampleLineCount": 4,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-600.woff2"
      },
      "benefit_1": {
        "fontId": "mulish",
        "family": "Mulish",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.0975056689342404,
        "lineHeight": 1.255,
        "tracking": 0,
        "align": "left",
        "color": "#d0d3d9",
        "fitScore": 0.428,
        "sampleBox": {
          "x": 0.19074074074074074,
          "y": 0.5003703703703704,
          "width": 0.18425925925925926,
          "height": 0.013703703703703704
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/mulish-900.woff2"
      },
      "benefit_3": {
        "fontId": "lato",
        "family": "Lato",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.4035087719298243,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#d7dadd",
        "fitScore": 0.392,
        "sampleBox": {
          "x": 0.19166666666666668,
          "y": 0.66,
          "width": 0.1925925925925926,
          "height": 0.012222222222222223
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/lato-900.woff2"
      },
      "benefit_2": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5423128046078864,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#c7c0b2",
        "fitScore": 0.624,
        "sampleBox": {
          "x": 0.11944444444444445,
          "y": 0.5681481481481482,
          "width": 0.22870370370370371,
          "height": 0.038148148148148146
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-400.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-buyers-wanted-story-235",
    "name": "Active Buyers Wanted \u2014 Story 235",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Homeowners who may sell when matched with active local buyers",
    "category": "buyer-demand-lead-generation",
    "tags": [
      "buyers-wanted",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-buyers-wanted-story-235-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_235.png",
    "sourceHash": "19c7b60c144dd4ccfe1c7c8767a2281ab5935590166c63f83ce7a04f212f862f",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 53,
        "sample": "ACTIVE BUYERS WANT HOMES LIKE YOURS",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 46,
        "sample": "SEE IF YOUR PROPERTY MATCHES",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 77,
        "sample": "We are speaking with qualified buyers looking in your area.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 36,
        "sample": "CHECK BUYER DEMAND",
        "required": true
      },
      {
        "key": "website",
        "label": "Website",
        "maxLength": 35,
        "sample": "youragency.com.au",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "background_photo",
        "label": "Background photo",
        "required": true,
        "box": {
          "x": 0,
          "y": 0,
          "width": 1,
          "height": 1
        }
      }
    ],
    "typography": {
      "body": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0378232005590498,
        "lineHeight": 1.424,
        "tracking": 0,
        "align": "center",
        "color": "#4b4a48",
        "fitScore": 0.587,
        "sampleBox": {
          "x": 0.25046296296296294,
          "y": 0.2765625,
          "width": 0.5078703703703704,
          "height": 0.04973958333333333
        },
        "sampleLineCount": 2,
        "detectionScore": 1
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238094948676906,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#100f0f",
        "fitScore": 0.566,
        "sampleBox": {
          "x": 0.09398148148148149,
          "y": 0.13385416666666666,
          "width": 0.8495370370370371,
          "height": 0.07552083333333333
        },
        "sampleLineCount": 6,
        "detectionScore": 0.729,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.32,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#886d35",
        "fitScore": 0.476,
        "sampleBox": {
          "x": 0.18055555555555555,
          "y": 0.23619791666666667,
          "width": 0.6712962962962963,
          "height": 0.015364583333333333
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "cta": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.500077639751553,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#bda781",
        "fitScore": 0.142,
        "sampleBox": {
          "x": 0.31296296296296294,
          "y": 0.3203125,
          "width": 0.4185185185185185,
          "height": 0.06328125
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      },
      "website": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.500625,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#4c3d2e",
        "fitScore": 0.659,
        "sampleBox": {
          "x": 0.4597222222222222,
          "y": 0.9638020833333333,
          "width": 0.2625,
          "height": 0.022395833333333334
        },
        "sampleLineCount": 2,
        "detectionScore": 0.882,
        "fontFile": "/fonts/adstudio/smooch-sans-400.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-buyers-wanted-story-272",
    "name": "Active Buyers Wanted \u2014 Story 272",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Homeowners who may sell when matched with active local buyers",
    "category": "buyer-demand-lead-generation",
    "tags": [
      "buyers-wanted",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-buyers-wanted-story-272-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_272.png",
    "sourceHash": "0adb3e7ec349be0a9203dd2e25ffa3bf17aedc60b4cc399cc3ea3a9fce98c00d",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 53,
        "sample": "ACTIVE BUYERS WANT HOMES LIKE YOURS",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 46,
        "sample": "SEE IF YOUR PROPERTY MATCHES",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 77,
        "sample": "We are speaking with qualified buyers looking in your area.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 36,
        "sample": "CHECK BUYER DEMAND",
        "required": true
      },
      {
        "key": "website",
        "label": "Website",
        "maxLength": 35,
        "sample": "youragency.com.au",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0268436578171092,
        "lineHeight": 1.424,
        "tracking": 0,
        "align": "left",
        "color": "#304476",
        "fitScore": 0.576,
        "sampleBox": {
          "x": 0.11435185185185186,
          "y": 0.825,
          "width": 0.6111111111111112,
          "height": 0.053385416666666664
        },
        "sampleLineCount": 2,
        "detectionScore": 1
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.523809541817182,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#a19da7",
        "fitScore": 0.301,
        "sampleBox": {
          "x": 0.10231481481481482,
          "y": 0.39296875,
          "width": 0.8,
          "height": 0.36328125
        },
        "sampleLineCount": 4,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2941176470588236,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "center",
        "color": "#154aa2",
        "fitScore": 0.446,
        "sampleBox": {
          "x": 0.11018518518518519,
          "y": 0.7828125,
          "width": 0.8037037037037037,
          "height": 0.019791666666666666
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-800.woff2"
      },
      "website": {
        "fontId": "quicksand",
        "family": "Quicksand",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.3457595526561044,
        "lineHeight": 1.25,
        "tracking": 0,
        "align": "center",
        "color": "#193674",
        "fitScore": 0.501,
        "sampleBox": {
          "x": 0.31805555555555554,
          "y": 0.058854166666666666,
          "width": 0.375,
          "height": 0.01796875
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/quicksand-600.woff2"
      },
      "cta": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.65,
        "lineHeight": 1.2,
        "tracking": 0.02,
        "align": "center",
        "color": "#304476",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.78,
          "width": 0.8,
          "height": 0.05
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-downsizer-consult-feed-103",
    "name": "Downsizer Consultation \u2014 Feed 103",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Established homeowners planning a simpler property move",
    "category": "downsizer-lead-generation",
    "tags": [
      "downsizer",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-downsizer-consult-feed-103-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_103.png",
    "sourceHash": "6877f2b0081b56a5d510501f88a9855f9b3934bd29be62a637bc256e04838305",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 44,
        "sample": "THINKING ABOUT DOWNSIZING?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 53,
        "sample": "PLAN YOUR NEXT MOVE WITH CONFIDENCE",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 96,
        "sample": "Talk through timing, value and suitable next-home options with a local expert.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 39,
        "sample": "BOOK A DOWNSIZER CHAT",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 30,
        "sample": "0400 123 456",
        "required": true
      },
      {
        "key": "website",
        "label": "Website",
        "maxLength": 35,
        "sample": "youragency.com.au",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo_1",
        "label": "Property photo 1",
        "required": true
      },
      {
        "key": "property_photo_2",
        "label": "Property photo 2",
        "required": true
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "quicksand",
        "family": "Quicksand",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0660497397339503,
        "lineHeight": 1.25,
        "tracking": 0,
        "align": "left",
        "color": "#4f5c69",
        "fitScore": 0.5,
        "sampleBox": {
          "x": 0.5550925925925926,
          "y": 0.725925925925926,
          "width": 0.26805555555555555,
          "height": 0.06222222222222222
        },
        "sampleLineCount": 3,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/quicksand-300.woff2"
      },
      "subheadline": {
        "fontId": "barlow-condensed",
        "family": "Barlow Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3846153846153848,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#c2baaf",
        "fitScore": 0.393,
        "sampleBox": {
          "x": 0.1736111111111111,
          "y": 0.6137037037037038,
          "width": 0.7185185185185186,
          "height": 0.06962962962962962
        },
        "sampleLineCount": 3,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/barlow-condensed-800.woff2"
      },
      "headline": {
        "fontId": "barlow-condensed",
        "family": "Barlow Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3617022002942756,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "right",
        "color": "#cfbfad",
        "fitScore": 0.272,
        "sampleBox": {
          "x": 0.30416666666666664,
          "y": 0.4162962962962963,
          "width": 0.6532407407407408,
          "height": 0.18888888888888888
        },
        "sampleLineCount": 4,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/barlow-condensed-800.woff2"
      },
      "cta": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.391304347826087,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#2d3e41",
        "fitScore": 0.405,
        "sampleBox": {
          "x": 0.5680555555555555,
          "y": 0.8248148148148148,
          "width": 0.30185185185185187,
          "height": 0.014814814814814815
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "website": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.482363315696649,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "right",
        "color": "#b1b4b2",
        "fitScore": 0.2,
        "sampleBox": {
          "x": 0.38935185185185184,
          "y": 0.9285185185185185,
          "width": 0.5435185185185185,
          "height": 0.027777777777777776
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      },
      "phone": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.224537037037037,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#3a4c5c",
        "fitScore": 0.391,
        "sampleBox": {
          "x": 0.7379629629629629,
          "y": 0.9003703703703704,
          "width": 0.14212962962962963,
          "height": 0.014444444444444444
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-downsizer-consult-feed-178",
    "name": "Downsizer Consultation \u2014 Feed 178",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Established homeowners planning a simpler property move",
    "category": "downsizer-lead-generation",
    "tags": [
      "downsizer",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-downsizer-consult-feed-178-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_178.png",
    "sourceHash": "8bace755ebc058a3c26ac189e8c39ce3934db8b35be83a11311a49269fc83cb1",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 44,
        "sample": "THINKING ABOUT DOWNSIZING?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 53,
        "sample": "PLAN YOUR NEXT MOVE WITH CONFIDENCE",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 96,
        "sample": "Talk through timing, value and suitable next-home options with a local expert.",
        "required": true
      },
      {
        "key": "benefit_1",
        "label": "Benefit 1",
        "maxLength": 31,
        "sample": "YOUR TIMELINE",
        "required": true
      },
      {
        "key": "benefit_2",
        "label": "Benefit 2",
        "maxLength": 28,
        "sample": "HOME VALUE",
        "required": true
      },
      {
        "key": "benefit_3",
        "label": "Benefit 3",
        "maxLength": 35,
        "sample": "NEXT-HOME OPTIONS",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 39,
        "sample": "BOOK A DOWNSIZER CHAT",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "background_photo",
        "label": "Background photo",
        "required": true,
        "box": {
          "x": 0,
          "y": 0,
          "width": 1,
          "height": 1
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.7888888888888889,
          "y": 0.84,
          "width": 0.14166666666666666,
          "height": 0.11481481481481481
        }
      }
    ],
    "typography": {
      "body": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0517959770114944,
        "lineHeight": 1.424,
        "tracking": 0,
        "align": "left",
        "color": "#a3998b",
        "fitScore": 0.499,
        "sampleBox": {
          "x": 0.08888888888888889,
          "y": 0.8333333333333334,
          "width": 0.49166666666666664,
          "height": 0.04777777777777778
        },
        "sampleLineCount": 2,
        "detectionScore": 1
      },
      "subheadline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5808270676691731,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#e6bb63",
        "fitScore": 0.434,
        "sampleBox": {
          "x": 0.09027777777777778,
          "y": 0.7933333333333333,
          "width": 0.6893518518518519,
          "height": 0.018518518518518517
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-800.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238094659123942,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#ad9e90",
        "fitScore": 0.412,
        "sampleBox": {
          "x": 0.08287037037037037,
          "y": 0.5077777777777778,
          "width": 0.7472222222222222,
          "height": 0.26037037037037036
        },
        "sampleLineCount": 3,
        "detectionScore": 0.84,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "benefit_3": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3529411764705883,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "right",
        "color": "#e4e1df",
        "fitScore": 0.423,
        "sampleBox": {
          "x": 0.6680555555555555,
          "y": 0.07296296296296297,
          "width": 0.25833333333333336,
          "height": 0.014444444444444444
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "benefit_1": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5388751033912325,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#beb5ad",
        "fitScore": 0.611,
        "sampleBox": {
          "x": 0.09675925925925925,
          "y": 0.07296296296296297,
          "width": 0.1962962962962963,
          "height": 0.03962962962962963
        },
        "sampleLineCount": 1,
        "detectionScore": 0.692,
        "fontFile": "/fonts/adstudio/smooch-sans-400.woff2"
      },
      "benefit_2": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3529411764705883,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#e9e6e4",
        "fitScore": 0.425,
        "sampleBox": {
          "x": 0.40185185185185185,
          "y": 0.07296296296296297,
          "width": 0.1550925925925926,
          "height": 0.014444444444444444
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "cta": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.65,
        "lineHeight": 1.2,
        "tracking": 0.02,
        "align": "center",
        "color": "#a3998b",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.78,
          "width": 0.8,
          "height": 0.05
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-downsizer-consult-story-266",
    "name": "Downsizer Consultation \u2014 Story 266",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Established homeowners planning a simpler property move",
    "category": "downsizer-lead-generation",
    "tags": [
      "downsizer",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-downsizer-consult-story-266-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_266.png",
    "sourceHash": "ee5e022ddeb1aec7e767858ea93e0664b85ac0a435d2115856b7340c700b272f",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 44,
        "sample": "THINKING ABOUT DOWNSIZING?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 53,
        "sample": "PLAN YOUR NEXT MOVE WITH CONFIDENCE",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 96,
        "sample": "Talk through timing, value and suitable next-home options with a local expert.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 39,
        "sample": "BOOK A DOWNSIZER CHAT",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 30,
        "sample": "0400 123 456",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true
      },
      {
        "key": "agent_portrait",
        "label": "Agent portrait",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "quicksand",
        "family": "Quicksand",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0571904761904762,
        "lineHeight": 1.25,
        "tracking": 0,
        "align": "center",
        "color": "#d1cac1",
        "fitScore": 0.534,
        "sampleBox": {
          "x": 0.2412037037037037,
          "y": 0.8278645833333333,
          "width": 0.525,
          "height": 0.0671875
        },
        "sampleLineCount": 3,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/quicksand-300.woff2"
      },
      "subheadline": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2124549328089151,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "center",
        "color": "#eae0d6",
        "fitScore": 0.507,
        "sampleBox": {
          "x": 0.1884259259259259,
          "y": 0.7380208333333333,
          "width": 0.638425925925926,
          "height": 0.06145833333333333
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-300.woff2"
      },
      "headline": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.0918367346938775,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#ede3d9",
        "fitScore": 0.453,
        "sampleBox": {
          "x": 0.12083333333333333,
          "y": 0.5966145833333333,
          "width": 0.7759259259259259,
          "height": 0.096875
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-300.woff2"
      },
      "cta": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2767462422634834,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#e6dcd1",
        "fitScore": 0.418,
        "sampleBox": {
          "x": 0.30648148148148147,
          "y": 0.92265625,
          "width": 0.5393518518518519,
          "height": 0.017708333333333333
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "phone": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 500,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.2903225806451613,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "center",
        "color": "#e5dcd1",
        "fitScore": 0.533,
        "sampleBox": {
          "x": 0.30324074074074076,
          "y": 0.953125,
          "width": 0.5083333333333333,
          "height": 0.03671875
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-500.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-downsizer-consult-story-314",
    "name": "Downsizer Consultation \u2014 Story 314",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Established homeowners planning a simpler property move",
    "category": "downsizer-lead-generation",
    "tags": [
      "downsizer",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-downsizer-consult-story-314-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_314.png",
    "sourceHash": "5db9bbfba2ed48dd9432aca11c264433a89e3ca5e651105eabbf397f8bfe1a53",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 44,
        "sample": "THINKING ABOUT DOWNSIZING?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 53,
        "sample": "PLAN YOUR NEXT MOVE WITH CONFIDENCE",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 96,
        "sample": "Talk through timing, value and suitable next-home options with a local expert.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 39,
        "sample": "BOOK A DOWNSIZER CHAT",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "couple_photo",
        "label": "Client lifestyle photo",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "quicksand",
        "family": "Quicksand",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0591397849462365,
        "lineHeight": 1.25,
        "tracking": 0,
        "align": "center",
        "color": "#a8abb0",
        "fitScore": 0.54,
        "sampleBox": {
          "x": 0.2162037037037037,
          "y": 0.74296875,
          "width": 0.5703703703703704,
          "height": 0.0890625
        },
        "sampleLineCount": 3,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/quicksand-300.woff2"
      },
      "subheadline": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3000949667616335,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#c1aa93",
        "fitScore": 0.455,
        "sampleBox": {
          "x": 0.09861111111111111,
          "y": 0.67734375,
          "width": 0.8425925925925926,
          "height": 0.017447916666666667
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "headline": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.1851851269709028,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "center",
        "color": "#f5f5f5",
        "fitScore": 0.452,
        "sampleBox": {
          "x": 0.07453703703703704,
          "y": 0.5380208333333333,
          "width": 0.8736111111111111,
          "height": 0.109375
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-300.woff2"
      },
      "cta": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5194681861348525,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#ece9e8",
        "fitScore": 0.459,
        "sampleBox": {
          "x": 0.24259259259259258,
          "y": 0.8924479166666667,
          "width": 0.5138888888888888,
          "height": 0.01875
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-700.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-feed-018",
    "name": "5 Costly Mistakes When Buying a Home",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Educate home buyers about common mistakes to avoid and generate buyer leads.",
    "category": "buyer_education",
    "tags": [
      "buyer",
      "education",
      "mistakes",
      "lead generation",
      "real estate"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-018-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_018.png",
    "sourceHash": "e67bfaec28cce6e1ea7cbddc6ed9e377533388484dce7d4cb98fa214c05f16f8",
    "textInputs": [
      {
        "key": "headline_number",
        "label": "Headline Number",
        "maxLength": 2,
        "sample": "5",
        "required": true
      },
      {
        "key": "headline_main",
        "label": "Headline Main",
        "maxLength": 30,
        "sample": "SMART FIRST STEPS",
        "required": true
      },
      {
        "key": "headline_sub",
        "label": "Headline Sub",
        "maxLength": 35,
        "sample": "Before Buying a Home",
        "required": true
      },
      {
        "key": "contact_handle",
        "label": "Contact Handle",
        "maxLength": 30,
        "sample": "@homeguide.example",
        "required": false
      }
    ],
    "imageInputs": [
      {
        "key": "main_property_image",
        "label": "Main Property Image",
        "required": true,
        "box": {
          "x": 0.576171875,
          "y": 0.16875,
          "width": 0.423828125,
          "height": 0.59765625
        }
      }
    ],
    "typography": {
      "headline_number": {
        "fontId": "outfit",
        "family": "Outfit",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "measurementSource": "manual-verified",
        "sizeRatio": 1.3913043929635895,
        "lineHeight": 1,
        "tracking": 0,
        "align": "left",
        "color": "#535046",
        "fitScore": 0.9,
        "sampleBox": {
          "x": 0.1689453125,
          "y": 0.20703125,
          "width": 0.1650390625,
          "height": 0.175
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "measuredLines": [
          {
            "text": "5",
            "sampleBox": {
              "x": 0.1689453125,
              "y": 0.20703125,
              "width": 0.1650390625,
              "height": 0.175
            },
            "sizeRatio": 1.3913043929635895,
            "scaleX": 0.9956477926063692
          }
        ],
        "fontFile": "/fonts/adstudio/outfit-600.woff2"
      },
      "headline_main": {
        "fontId": "league-gothic",
        "family": "League Gothic",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "measurementSource": "manual-verified",
        "sizeRatio": 0.6025230532786886,
        "lineHeight": 1,
        "tracking": 0,
        "align": "left",
        "color": "#535046",
        "fitScore": 0.9,
        "sampleBox": {
          "x": 0.0849609375,
          "y": 0.465625,
          "width": 0.43505859375,
          "height": 0.24453125
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "measuredLines": [
          {
            "text": "SMART",
            "sampleBox": {
              "x": 0.08642578125,
              "y": 0.465625,
              "width": 0.3544921875,
              "height": 0.13515625
            },
            "sizeRatio": 1.3307692307692307,
            "scaleX": 0.8298660071710934
          },
          {
            "text": "FIRST STEPS",
            "sampleBox": {
              "x": 0.0849609375,
              "y": 0.61796875,
              "width": 0.43505859375,
              "height": 0.0921875
            },
            "sizeRatio": 1.3258426966292136,
            "scaleX": 0.847360847658376
          }
        ],
        "fontFile": "/fonts/adstudio/league-gothic-400.woff2"
      },
      "headline_sub": {
        "fontId": "roboto-condensed",
        "family": "Roboto Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "mixed",
        "measurementVersion": 2,
        "measurementSource": "manual-verified",
        "sizeRatio": 1.02648891966759,
        "lineHeight": 1,
        "tracking": 0,
        "align": "left",
        "color": "#6e6a61",
        "fitScore": 0.85,
        "sampleBox": {
          "x": 0.0859375,
          "y": 0.7375,
          "width": 0.4326171875,
          "height": 0.030078125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "measuredLines": [
          {
            "text": "Before Buying a Home",
            "sampleBox": {
              "x": 0.0859375,
              "y": 0.7375,
              "width": 0.4326171875,
              "height": 0.030078125
            },
            "sizeRatio": 1.02648891966759,
            "scaleX": 1.258
          }
        ],
        "fontFile": "/fonts/adstudio/roboto-condensed-400.woff2"
      },
      "contact_handle": {
        "fontId": "roboto-condensed",
        "family": "Roboto Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "lower",
        "measurementVersion": 2,
        "measurementSource": "manual-verified",
        "sizeRatio": 1.0385395537525355,
        "lineHeight": 1,
        "tracking": 0,
        "align": "left",
        "color": "#716d64",
        "fitScore": 0.85,
        "sampleBox": {
          "x": 0.0869140625,
          "y": 0.840625,
          "width": 0.33154296875,
          "height": 0.025
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "measuredLines": [
          {
            "text": "@homeguide.example",
            "sampleBox": {
              "x": 0.0869140625,
              "y": 0.840625,
              "width": 0.33154296875,
              "height": 0.025
            },
            "sizeRatio": 1.0385395537525355,
            "scaleX": 1.14
          }
        ],
        "fontFile": "/fonts/adstudio/roboto-condensed-400.woff2"
      }
    },
    "deterministicStatus": "ready"
  },
  {
    "id": "meta-feed-020",
    "name": "Just Listed Sage Panel",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Buyers watching the suburb for fresh stock; owners gauging local prices before selling.",
    "category": "listing",
    "tags": [
      "listing",
      "just-listed",
      "price",
      "meta-feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-020-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_061.png",
    "sourceHash": "86e3bed929d7cdad06e487f758db7a7476e2452c43b4ffe78a1046b488ef43f1",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 24,
        "sample": "JUST LISTED",
        "required": true
      },
      {
        "key": "price",
        "label": "Price",
        "maxLength": 24,
        "sample": "Offers from $895,000",
        "required": true
      },
      {
        "key": "address",
        "label": "Address",
        "maxLength": 54,
        "sample": "18 Tallow Lane, Scarborough WA",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 24,
        "sample": "08 6102 1840",
        "required": true
      },
      {
        "key": "website_handle",
        "label": "Website or handle",
        "maxLength": 40,
        "sample": "harbourandkey.com.au",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property image",
        "required": true
      },
      {
        "key": "brand_logo",
        "label": "Agency logo",
        "required": true
      }
    ],
    "typography": {
      "address": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.04,
        "lineHeight": 1.424,
        "tracking": 0,
        "align": "left",
        "color": "#b9b8b6",
        "fitScore": 0.497,
        "sampleBox": {
          "x": 0.048828125,
          "y": 0.434375,
          "width": 0.3271484375,
          "height": 0.053125
        },
        "sampleLineCount": 3,
        "detectionScore": 1
      },
      "price": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.1439075630252102,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#64686a",
        "fitScore": 0.261,
        "sampleBox": {
          "x": 0.138671875,
          "y": 0.314453125,
          "width": 0.7265625,
          "height": 0.023046875
        },
        "sampleLineCount": 2,
        "detectionScore": 0.65,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      },
      "website_handle": {
        "fontId": "karla",
        "family": "Karla",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.0596885813148786,
        "lineHeight": 1.169,
        "tracking": 0,
        "align": "left",
        "color": "#dfe2e2",
        "fitScore": 0.613,
        "sampleBox": {
          "x": 0.13623046875,
          "y": 0.890625,
          "width": 0.349609375,
          "height": 0.024609375
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/karla-600.woff2"
      },
      "phone": {
        "fontId": "playfair-display",
        "family": "Playfair Display",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.1111111111111112,
        "lineHeight": 1.333,
        "tracking": 0,
        "align": "left",
        "color": "#e3e6e5",
        "fitScore": 0.433,
        "sampleBox": {
          "x": 0.1357421875,
          "y": 0.85546875,
          "width": 0.21044921875,
          "height": 0.0203125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/playfair-display-700.woff2"
      },
      "headline": {
        "fontId": "open-sans",
        "family": "Open Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.0847457846291142,
        "lineHeight": 1.36181640625,
        "tracking": 0,
        "align": "left",
        "color": "#f3f5f5",
        "fitScore": 0.563,
        "sampleBox": {
          "x": 0.13330078125,
          "y": 0.099609375,
          "width": 0.3720703125,
          "height": 0.1734375
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/open-sans-300.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-feed-055",
    "name": "Just Sold - A New Chapter Starts Here",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Homeowners interested in selling or learning about recent sales in their area.",
    "category": "just_sold",
    "tags": [
      "just sold",
      "recent sale",
      "seller leads",
      "real estate",
      "agent branding"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-055-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_055.png",
    "sourceHash": "82c1f3f48d910b3daeaf4d347fabce2ed5c56721287e03826c5d8184368c10b9",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 20,
        "sample": "Just sold",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 40,
        "sample": "A NEW CHAPTER STARTS HERE",
        "required": false
      },
      {
        "key": "agent_name",
        "label": "Agent Name",
        "maxLength": 30,
        "sample": "AVA BENNETT",
        "required": true
      },
      {
        "key": "agent_phone",
        "label": "Agent Phone Number",
        "maxLength": 20,
        "sample": "+123-555-0155",
        "required": true
      },
      {
        "key": "agent_email",
        "label": "Agent Email",
        "maxLength": 40,
        "sample": "hello@bennett.example",
        "required": true
      },
      {
        "key": "contact_label",
        "label": "Contact Label",
        "maxLength": 20,
        "sample": "contact me",
        "required": false
      }
    ],
    "imageInputs": [
      {
        "key": "property_image",
        "label": "Property Image",
        "required": true
      },
      {
        "key": "agent_photo",
        "label": "Agent Photo",
        "required": true
      }
    ],
    "typography": {
      "subheadline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5148051948051948,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#4e483c",
        "fitScore": 0.54,
        "sampleBox": {
          "x": 0.69677734375,
          "y": 0.09765625,
          "width": 0.20751953125,
          "height": 0.0375
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-400.woff2"
      },
      "agent_email": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 600,
        "italic": false,
        "case": "lower",
        "sizeRatio": 0.8709677419354839,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#625c52",
        "fitScore": 0.628,
        "sampleBox": {
          "x": 0.6357421875,
          "y": 0.90625,
          "width": 0.271484375,
          "height": 0.018359375
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-600.woff2"
      },
      "agent_name": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3125,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#5d584d",
        "fitScore": 0.407,
        "sampleBox": {
          "x": 0.7470703125,
          "y": 0.85859375,
          "width": 0.1611328125,
          "height": 0.01328125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "contact_label": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.2959183673469388,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "left",
        "color": "#2a2b28",
        "fitScore": 0.324,
        "sampleBox": {
          "x": 0.40478515625,
          "y": 0.491796875,
          "width": 0.05908203125,
          "height": 0.087109375
        },
        "sampleLineCount": 3,
        "detectionScore": 0.4,
        "fontFile": "/fonts/adstudio/oswald-300.woff2"
      },
      "headline": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.1851851407934986,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "center",
        "color": "#beb6a6",
        "fitScore": 0.256,
        "sampleBox": {
          "x": 0.05615234375,
          "y": 0.58125,
          "width": 0.85693359375,
          "height": 0.22421875
        },
        "sampleLineCount": 3,
        "detectionScore": 0.556,
        "fontFile": "/fonts/adstudio/oswald-600.woff2"
      },
      "agent_phone": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.55,
        "lineHeight": 1.2,
        "tracking": 0.01,
        "align": "center",
        "color": "#4e483c",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.9,
          "width": 0.8,
          "height": 0.03
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/merriweather-300.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-feed-128",
    "name": "Just Sold Announcement - New Chapter",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Showcase a recently sold property and attract new seller leads.",
    "category": "just_sold",
    "tags": [
      "just sold",
      "seller leads",
      "real estate",
      "announcement",
      "new chapter"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-128-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_128.png",
    "sourceHash": "c37d0b77e60869df409e48ff386281f60f5f62a5b876fb069395446eecf43baf",
    "textInputs": [
      {
        "key": "property_address",
        "label": "Property Address",
        "maxLength": 60,
        "sample": "8 MARINE TERRACE, COTTESLOE WA",
        "required": true
      },
      {
        "key": "main_message",
        "label": "Main Message",
        "maxLength": 60,
        "sample": "Just Sold! A new chapter begins.",
        "required": true
      },
      {
        "key": "contact_email",
        "label": "Contact Email",
        "maxLength": 40,
        "sample": "hello@cedarcoast.example",
        "required": true
      },
      {
        "key": "contact_phone",
        "label": "Contact Phone",
        "maxLength": 20,
        "sample": "08 6102 1840",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property Photo",
        "required": true,
        "box": {
          "x": 0.017578125,
          "y": 0.1125,
          "width": 0.96484375,
          "height": 0.4734375
        }
      },
      {
        "key": "agent_photo",
        "label": "Agent Photo",
        "required": true,
        "box": {
          "x": 0.662109375,
          "y": 0.4984375,
          "width": 0.216796875,
          "height": 0.1734375
        }
      }
    ],
    "typography": {
      "main_message": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0322580888232409,
        "lineHeight": 1.424,
        "tracking": 0,
        "align": "center",
        "color": "#433d31",
        "fitScore": 0.638,
        "sampleBox": {
          "x": 0.111328125,
          "y": 0.633984375,
          "width": 0.78515625,
          "height": 0.21875
        },
        "sampleLineCount": 3,
        "detectionScore": 0.833
      },
      "property_address": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.0432098765432096,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#585247",
        "fitScore": 0.804,
        "sampleBox": {
          "x": 0.244140625,
          "y": 0.059765625,
          "width": 0.5380859375,
          "height": 0.017578125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-700.woff2"
      },
      "contact_email": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.0012771392081736,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "left",
        "color": "#5a5449",
        "fitScore": 0.577,
        "sampleBox": {
          "x": 0.1103515625,
          "y": 0.894921875,
          "width": 0.3125,
          "height": 0.01875
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-600.woff2"
      },
      "contact_phone": {
        "fontId": "playfair-display",
        "family": "Playfair Display",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.1020833333333333,
        "lineHeight": 1.333,
        "tracking": 0,
        "align": "left",
        "color": "#565146",
        "fitScore": 0.447,
        "sampleBox": {
          "x": 0.71728515625,
          "y": 0.894921875,
          "width": 0.16015625,
          "height": 0.015234375
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/playfair-display-700.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-feed-150",
    "name": "New Listing - 123 Anywhere St.",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Attract buyers interested in a newly listed residential property.",
    "category": "residential_listing",
    "tags": [
      "new listing",
      "for sale",
      "residential",
      "buyer leads"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-150-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_150.png",
    "sourceHash": "f8ac3bf2b46c2819b6dfa359c663fe62747f96392cc181cf8ba12866b460fa80",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 30,
        "sample": "New Listing",
        "required": true
      },
      {
        "key": "address",
        "label": "Property Address",
        "maxLength": 60,
        "sample": "14 Alder Lane, Greenvale, WA 6210",
        "required": true
      },
      {
        "key": "property_details",
        "label": "Property Details",
        "maxLength": 60,
        "sample": "4 bed \u00b7 3 bath \u00b7 1,850 sqft \u00b7 9,400 sqft lot",
        "required": true
      },
      {
        "key": "asking_price",
        "label": "Asking Price",
        "maxLength": 30,
        "sample": "Asking $915,000",
        "required": true
      },
      {
        "key": "agent_contact",
        "label": "Agent Contact",
        "maxLength": 50,
        "sample": "Contact Amelia Hart +123-555-0182",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "main_photo",
        "label": "Main Property Photo",
        "required": true,
        "box": {
          "x": 0.091796875,
          "y": 0.1609375,
          "width": 0.818359375,
          "height": 0.39375
        }
      },
      {
        "key": "interior_photo_1",
        "label": "Interior Photo 1",
        "required": true,
        "box": {
          "x": 0.091796875,
          "y": 0.5625,
          "width": 0.2724609375,
          "height": 0.23359375
        }
      },
      {
        "key": "interior_photo_2",
        "label": "Interior Photo 2",
        "required": true,
        "box": {
          "x": 0.3671875,
          "y": 0.5625,
          "width": 0.271484375,
          "height": 0.23359375
        }
      },
      {
        "key": "interior_photo_3",
        "label": "Interior Photo 3",
        "required": true,
        "box": {
          "x": 0.6416015625,
          "y": 0.5625,
          "width": 0.2685546875,
          "height": 0.23359375
        }
      }
    ],
    "typography": {
      "property_details": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 600,
        "italic": false,
        "case": "lower",
        "sizeRatio": 0.9117647058823529,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#c2beba",
        "fitScore": 0.674,
        "sampleBox": {
          "x": 0.09228515625,
          "y": 0.86796875,
          "width": 0.490234375,
          "height": 0.02109375
        },
        "sampleLineCount": 1,
        "detectionScore": 0.842,
        "fontFile": "/fonts/adstudio/merriweather-600.woff2"
      },
      "address": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0314465408805031,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "center",
        "color": "#5c5247",
        "fitScore": 0.296,
        "sampleBox": {
          "x": 0.0927734375,
          "y": 0.740625,
          "width": 0.8056640625,
          "height": 0.111328125
        },
        "sampleLineCount": 2,
        "detectionScore": 0.677,
        "fontFile": "/fonts/adstudio/oswald-600.woff2"
      },
      "agent_contact": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.1904761904761905,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#c9c6c2",
        "fitScore": 0.529,
        "sampleBox": {
          "x": 0.091796875,
          "y": 0.941796875,
          "width": 0.45361328125,
          "height": 0.016796875
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-700.woff2"
      },
      "asking_price": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 0.8823529411764706,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "left",
        "color": "#c1beb9",
        "fitScore": 0.627,
        "sampleBox": {
          "x": 0.091796875,
          "y": 0.905078125,
          "width": 0.2080078125,
          "height": 0.020703125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-600.woff2"
      },
      "headline": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0003430531732418,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "center",
        "color": "#e0dad5",
        "fitScore": 0.771,
        "sampleBox": {
          "x": 0.2705078125,
          "y": 0.0484375,
          "width": 0.48095703125,
          "height": 0.073828125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-300.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-feed-151",
    "name": "Open House This Sunday - Modern Home Showcase",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Attend an open house and inquire about purchasing a modern home.",
    "category": "open_home",
    "tags": [
      "open house",
      "modern home",
      "real estate",
      "buyer leads",
      "property tour"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-151-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_151.png",
    "sourceHash": "14b9dc6b4444b2da96cdc95cec203654772ac935125035ef8d5230fa4f028979",
    "textInputs": [
      {
        "key": "brand_name",
        "label": "Agency Name",
        "maxLength": 20,
        "sample": "HARBOURLINE",
        "required": true
      },
      {
        "key": "listing_price",
        "label": "Listing Price",
        "maxLength": 20,
        "sample": "$860,000",
        "required": true
      },
      {
        "key": "open_house_date",
        "label": "Open House Date",
        "maxLength": 30,
        "sample": "21st June 2026",
        "required": true
      },
      {
        "key": "open_house_time",
        "label": "Open House Time",
        "maxLength": 20,
        "sample": "10 AM - 2 PM",
        "required": true
      },
      {
        "key": "bedrooms",
        "label": "Number of Bedrooms",
        "maxLength": 10,
        "sample": "4 Beds",
        "required": true
      },
      {
        "key": "bathrooms",
        "label": "Number of Bathrooms",
        "maxLength": 10,
        "sample": "2 Baths",
        "required": true
      },
      {
        "key": "area",
        "label": "Property Area",
        "maxLength": 15,
        "sample": "2,400 sqft",
        "required": true
      },
      {
        "key": "features",
        "label": "Key Features",
        "maxLength": 50,
        "sample": "Car Port, Pool, Garden",
        "required": true
      },
      {
        "key": "agent_name",
        "label": "Agent Name",
        "maxLength": 40,
        "sample": "Sophie Hale",
        "required": true
      },
      {
        "key": "agent_phone",
        "label": "Agent Phone Number",
        "maxLength": 20,
        "sample": "+123-555-0126",
        "required": true
      },
      {
        "key": "agent_website",
        "label": "Agent Website",
        "maxLength": 50,
        "sample": "www.harbourline.example",
        "required": false
      }
    ],
    "imageInputs": [
      {
        "key": "main_exterior",
        "label": "Main Exterior Photo",
        "required": true,
        "box": {
          "x": 0,
          "y": 0.2451851851851852,
          "width": 0.6388888888888888,
          "height": 0.45555555555555555
        }
      },
      {
        "key": "interior_1",
        "label": "Interior Photo 1",
        "required": true,
        "box": {
          "x": 0.6546296296296297,
          "y": 0.22444444444444445,
          "width": 0.24351851851851852,
          "height": 0.17037037037037037
        }
      },
      {
        "key": "interior_2",
        "label": "Interior Photo 2",
        "required": true,
        "box": {
          "x": 0.6546296296296297,
          "y": 0.4022222222222222,
          "width": 0.24351851851851852,
          "height": 0.16074074074074074
        }
      },
      {
        "key": "interior_3",
        "label": "Interior Photo 3",
        "required": true,
        "box": {
          "x": 0.6546296296296297,
          "y": 0.5718518518518518,
          "width": 0.24351851851851852,
          "height": 0.16592592592592592
        }
      },
      {
        "key": "agent_photo",
        "label": "Agent Photo",
        "required": false,
        "box": {
          "x": 0.7055555555555556,
          "y": 0.7651851851851852,
          "width": 0.1824074074074074,
          "height": 0.15925925925925927
        }
      }
    ],
    "typography": {
      "agent_website": {
        "fontId": "quicksand",
        "family": "Quicksand",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.1025000000000003,
        "lineHeight": 1.25,
        "tracking": 0,
        "align": "left",
        "color": "#5d5a58",
        "fitScore": 0.618,
        "sampleBox": {
          "x": 0.51416015625,
          "y": 0.95078125,
          "width": 0.205078125,
          "height": 0.01328125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/quicksand-700.woff2"
      },
      "features": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.1911764705882353,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "left",
        "color": "#5d5c5b",
        "fitScore": 0.711,
        "sampleBox": {
          "x": 0.23828125,
          "y": 0.9078125,
          "width": 0.1708984375,
          "height": 0.0109375
        },
        "sampleLineCount": 2,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/manrope-800.woff2"
      },
      "open_house_date": {
        "fontId": "fira-sans",
        "family": "Fira Sans",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0909090909090908,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#574f4a",
        "fitScore": 0.444,
        "sampleBox": {
          "x": 0.51416015625,
          "y": 0.90703125,
          "width": 0.20361328125,
          "height": 0.015625
        },
        "sampleLineCount": 1,
        "detectionScore": 0.357,
        "fontFile": "/fonts/adstudio/fira-sans-900.woff2"
      },
      "open_house_time": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 500,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2799999763866812,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#a69f99",
        "fitScore": 0.304,
        "sampleBox": {
          "x": 0.6953125,
          "y": 0.17890625,
          "width": 0.212890625,
          "height": 0.16640625
        },
        "sampleLineCount": 5,
        "detectionScore": 0.385,
        "fontFile": "/fonts/adstudio/merriweather-500.woff2"
      },
      "brand_name": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 500,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5162907268170427,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#564c47",
        "fitScore": 0.672,
        "sampleBox": {
          "x": 0.05908203125,
          "y": 0.035546875,
          "width": 0.23486328125,
          "height": 0.038671875
        },
        "sampleLineCount": 1,
        "detectionScore": 0.786,
        "fontFile": "/fonts/adstudio/smooch-sans-500.woff2"
      },
      "agent_name": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "left",
        "color": "#545251",
        "fitScore": 0.539,
        "sampleBox": {
          "x": 0.51318359375,
          "y": 0.883984375,
          "width": 0.1142578125,
          "height": 0.015234375
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-700.woff2"
      },
      "area": {
        "fontId": "rubik",
        "family": "Rubik",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.0701020643081882,
        "lineHeight": 1.185,
        "tracking": 0,
        "align": "center",
        "color": "#c9c7bc",
        "fitScore": 0.201,
        "sampleBox": {
          "x": 0.10693359375,
          "y": 0.711328125,
          "width": 0.69189453125,
          "height": 0.11328125
        },
        "sampleLineCount": 4,
        "detectionScore": 0.9,
        "fontFile": "/fonts/adstudio/rubik-900.woff2"
      },
      "bathrooms": {
        "fontId": "playfair-display",
        "family": "Playfair Display",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.121107266435986,
        "lineHeight": 1.333,
        "tracking": 0,
        "align": "left",
        "color": "#565556",
        "fitScore": 0.372,
        "sampleBox": {
          "x": 0.2236328125,
          "y": 0.811328125,
          "width": 0.0625,
          "height": 0.0109375
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/playfair-display-800.woff2"
      },
      "bedrooms": {
        "fontId": "playfair-display",
        "family": "Playfair Display",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0030959752321982,
        "lineHeight": 1.333,
        "tracking": 0,
        "align": "left",
        "color": "#545455",
        "fitScore": 0.44,
        "sampleBox": {
          "x": 0.1015625,
          "y": 0.811328125,
          "width": 0.056640625,
          "height": 0.0109375
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/playfair-display-800.woff2"
      },
      "listing_price": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "mixed",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.7,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#5d5a58",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.5,
          "width": 0.8,
          "height": 0.06
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/manrope-400.woff2"
      },
      "agent_phone": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "mixed",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.55,
        "lineHeight": 1.2,
        "tracking": 0.01,
        "align": "center",
        "color": "#5d5a58",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.9,
          "width": 0.8,
          "height": 0.03
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/manrope-400.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-feed-152",
    "name": "Smart Tips for Home Buyers",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "People looking for advice and tips to buy a home and avoid costly mistakes.",
    "category": "real_estate",
    "tags": [
      "home buyers",
      "real estate tips",
      "buyer advice",
      "property purchase",
      "mistake avoidance"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-152-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_152.png",
    "sourceHash": "365aa30a9da93245638a9d4daee66694b189677bde9cef052688ff49ceb6e803",
    "textInputs": [
      {
        "key": "brand_name",
        "label": "Brand Name",
        "maxLength": 20,
        "sample": "HAVENFIELD",
        "required": true
      },
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 40,
        "sample": "SMART TIPS FOR HOME BUYERS",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 30,
        "sample": "Avoid Costly Mistakes",
        "required": false
      },
      {
        "key": "cta",
        "label": "Call to Action",
        "maxLength": 15,
        "sample": "Learn More",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "main_property_image",
        "label": "Main Property Image",
        "required": true
      }
    ],
    "typography": {
      "headline": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3061224668837155,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "left",
        "color": "#c0bdb8",
        "fitScore": 0.231,
        "sampleBox": {
          "x": 0.12158203125,
          "y": 0.55390625,
          "width": 0.57177734375,
          "height": 0.329296875
        },
        "sampleLineCount": 7,
        "detectionScore": 0.929,
        "fontFile": "/fonts/adstudio/manrope-400.woff2"
      },
      "subheadline": {
        "fontId": "arimo",
        "family": "Arimo",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0579591836734692,
        "lineHeight": 1.14990234375,
        "tracking": 0,
        "align": "left",
        "color": "#605851",
        "fitScore": 0.577,
        "sampleBox": {
          "x": 0.1162109375,
          "y": 0.906640625,
          "width": 0.341796875,
          "height": 0.025
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/arimo-600.woff2"
      },
      "brand_name": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3351648351648353,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#5b534b",
        "fitScore": 0.429,
        "sampleBox": {
          "x": 0.09423828125,
          "y": 0.0875,
          "width": 0.19189453125,
          "height": 0.01796875
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "cta": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.391304347826087,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#5f574e",
        "fitScore": 0.423,
        "sampleBox": {
          "x": 0.75390625,
          "y": 0.9,
          "width": 0.14404296875,
          "height": 0.015625
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-feed-156",
    "name": "Your Trusted Real Estate Partner",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Find a reliable real estate partner for buying or selling property",
    "category": "agent_branding",
    "tags": [
      "real estate",
      "agent",
      "branding",
      "seller leads",
      "property",
      "professional"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-156-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_156.png",
    "sourceHash": "3e0b29ed50a71905d5890f3fd7d5dc017610e02c24d96ee2790c7de72d82fdff",
    "textInputs": [
      {
        "key": "company_name",
        "label": "Company Name",
        "maxLength": 40,
        "sample": "Summit Lane Property",
        "required": true
      },
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 60,
        "sample": "Local advice. Clear next steps.",
        "required": true
      },
      {
        "key": "agent_name",
        "label": "Agent Name",
        "maxLength": 40,
        "sample": "Jordan Lee",
        "required": true
      },
      {
        "key": "about_text",
        "label": "About/Description",
        "maxLength": 240,
        "sample": "Practical advice for buying, selling, and investing, with clear communication from the first conversation to settlement.",
        "required": true
      },
      {
        "key": "cta_text",
        "label": "Call To Action",
        "maxLength": 25,
        "sample": "BOOK A CALL",
        "required": true
      },
      {
        "key": "phone_number",
        "label": "Phone Number",
        "maxLength": 20,
        "sample": "08 6102 1840",
        "required": true
      },
      {
        "key": "website_url",
        "label": "Website URL",
        "maxLength": 60,
        "sample": "summitlane.example",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "background_property",
        "label": "Background Property Image",
        "required": true,
        "box": {
          "x": 0,
          "y": 0,
          "width": 1,
          "height": 0.48
        }
      },
      {
        "key": "agent_photo",
        "label": "Agent Portrait Photo",
        "required": true,
        "box": {
          "x": 0.5361111111111111,
          "y": 0.3725925925925926,
          "width": 0.35648148148148145,
          "height": 0.3296296296296296
        }
      }
    ],
    "typography": {
      "headline": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 0.9696970106464223,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "left",
        "color": "#707169",
        "fitScore": 0.258,
        "sampleBox": {
          "x": 0.10791015625,
          "y": 0.241015625,
          "width": 0.55908203125,
          "height": 0.18359375
        },
        "sampleLineCount": 12,
        "detectionScore": 0.452,
        "fontFile": "/fonts/adstudio/oswald-400.woff2"
      },
      "company_name": {
        "fontId": "titillium-web",
        "family": "Titillium Web",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.1287569573283858,
        "lineHeight": 1.521,
        "tracking": 0,
        "align": "right",
        "color": "#72777a",
        "fitScore": 0.195,
        "sampleBox": {
          "x": 0.12109375,
          "y": 0.11875,
          "width": 0.87890625,
          "height": 0.053515625
        },
        "sampleLineCount": 3,
        "detectionScore": 0.6,
        "fontFile": "/fonts/adstudio/titillium-web-900.woff2"
      },
      "website_url": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.1093795093795094,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "left",
        "color": "#cec5bc",
        "fitScore": 0.498,
        "sampleBox": {
          "x": 0.48193359375,
          "y": 0.9203125,
          "width": 0.37841796875,
          "height": 0.042578125
        },
        "sampleLineCount": 1,
        "detectionScore": 0.857,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      },
      "phone_number": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.4871794871794872,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "left",
        "color": "#cec3b8",
        "fitScore": 0.745,
        "sampleBox": {
          "x": 0.09619140625,
          "y": 0.921875,
          "width": 0.24365234375,
          "height": 0.039453125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      },
      "cta_text": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.481025641025641,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#f4f3f3",
        "fitScore": 0.428,
        "sampleBox": {
          "x": 0.609375,
          "y": 0.843359375,
          "width": 0.2958984375,
          "height": 0.026953125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-800.woff2"
      },
      "agent_name": {
        "fontId": "roboto-condensed",
        "family": "Roboto Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.3095238095238095,
        "lineHeight": 1.171875,
        "tracking": 0,
        "align": "left",
        "color": "#4e4841",
        "fitScore": 0.455,
        "sampleBox": {
          "x": 0.119140625,
          "y": 0.553515625,
          "width": 0.3388671875,
          "height": 0.03828125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/roboto-condensed-700.woff2"
      },
      "about_text": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.45,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#707169",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.55,
          "width": 0.8,
          "height": 0.12
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/kanit-300.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-feed-160",
    "name": "Seller Tips Swipe Card",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Homeowners interested in selling quickly",
    "category": "real_estate_tips",
    "tags": [
      "seller_tips",
      "home_selling",
      "real_estate",
      "fast_sale"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-160-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_160.png",
    "sourceHash": "bf822ee54607bafdb6aad3907a99fccfb6a348a48b846d3e64e3193e35562866",
    "textInputs": [
      {
        "key": "profile_handle",
        "label": "Profile Handle",
        "maxLength": 30,
        "sample": "@cedarcoast.example",
        "required": true
      },
      {
        "key": "header",
        "label": "Header",
        "maxLength": 25,
        "sample": "SELLER NOTES",
        "required": true
      },
      {
        "key": "main_title",
        "label": "Main Title",
        "maxLength": 60,
        "sample": "Ready, Set, Sell: 5 Steps for a Smoother Sale",
        "required": true
      },
      {
        "key": "cta_button",
        "label": "Call to Action Button",
        "maxLength": 30,
        "sample": "SWIPE FOR 5 STEPS",
        "required": true
      },
      {
        "key": "share_prompt",
        "label": "Share Prompt",
        "maxLength": 25,
        "sample": "Share this guide",
        "required": false
      },
      {
        "key": "save_prompt",
        "label": "Save Prompt",
        "maxLength": 25,
        "sample": "Save for later",
        "required": false
      }
    ],
    "imageInputs": [
      {
        "key": "background_photo",
        "label": "Background Property Photo",
        "required": true,
        "box": {
          "x": 0,
          "y": 0,
          "width": 1,
          "height": 1
        }
      }
    ],
    "typography": {
      "main_title": {
        "fontId": "quicksand",
        "family": "Quicksand",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.049180351070623,
        "lineHeight": 1.25,
        "tracking": 0,
        "align": "center",
        "color": "#1b1b1b",
        "fitScore": 0.573,
        "sampleBox": {
          "x": 0.23193359375,
          "y": 0.348046875,
          "width": 0.51806640625,
          "height": 0.233984375
        },
        "sampleLineCount": 4,
        "detectionScore": 0.93,
        "fontFile": "/fonts/adstudio/quicksand-300.woff2"
      },
      "profile_handle": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "left",
        "color": "#84745b",
        "fitScore": 0.283,
        "sampleBox": {
          "x": 0.00146484375,
          "y": 0.148046875,
          "width": 0.1591796875,
          "height": 0.062109375
        },
        "sampleLineCount": 4,
        "detectionScore": 0.389,
        "fontFile": "/fonts/adstudio/oswald-600.woff2"
      },
      "cta_button": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3059006211180126,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#e5e6e9",
        "fitScore": 0.414,
        "sampleBox": {
          "x": 0.2841796875,
          "y": 0.66171875,
          "width": 0.2890625,
          "height": 0.01953125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "share_prompt": {
        "fontId": "raleway",
        "family": "Raleway",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0596885813148786,
        "lineHeight": 1.174,
        "tracking": 0,
        "align": "left",
        "color": "#ede7e0",
        "fitScore": 0.605,
        "sampleBox": {
          "x": 0.06298828125,
          "y": 0.93515625,
          "width": 0.24951171875,
          "height": 0.02421875
        },
        "sampleLineCount": 1,
        "detectionScore": 0.842,
        "fontFile": "/fonts/adstudio/raleway-600.woff2"
      },
      "save_prompt": {
        "fontId": "raleway",
        "family": "Raleway",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.3481884057971014,
        "lineHeight": 1.174,
        "tracking": 0,
        "align": "right",
        "color": "#cdc0b5",
        "fitScore": 0.571,
        "sampleBox": {
          "x": 0.7607421875,
          "y": 0.9265625,
          "width": 0.16748046875,
          "height": 0.041796875
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/raleway-400.woff2"
      },
      "header": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3520000000000003,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#1d1d1d",
        "fitScore": 0.413,
        "sampleBox": {
          "x": 0.2333984375,
          "y": 0.293359375,
          "width": 0.228515625,
          "height": 0.017578125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-feed-161",
    "name": "New Listing Announcement",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Attract buyers interested in a newly listed property",
    "category": "listing",
    "tags": [
      "new listing",
      "property",
      "real estate",
      "announcement"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-161-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_161.png",
    "sourceHash": "7624e985946df2cc7803477fb635cb6e48589c75b4faf4da53eb2093d36a15a6",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 20,
        "sample": "NEW LISTING",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_image",
        "label": "Property Image",
        "required": true,
        "box": {
          "x": 0,
          "y": 0,
          "width": 1,
          "height": 1
        }
      }
    ],
    "typography": {
      "headline": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5517241379310347,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#1e1e1e",
        "fitScore": 0.086,
        "sampleBox": {
          "x": 0.3349609375,
          "y": 0.23671875,
          "width": 0.3125,
          "height": 0.0203125
        },
        "sampleLineCount": 3,
        "detectionScore": 0.364,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-feed-162",
    "name": "Borcelle Villa For Rent",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "People looking to rent a premium villa for short stays",
    "category": "rental_property",
    "tags": [
      "villa",
      "for rent",
      "luxury",
      "short term",
      "2 bedroom",
      "living room",
      "kitchen"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-162-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_162.png",
    "sourceHash": "70d1efbae33cb4121acd82cead76daa3189a611d3deb3c6e10e9e08f490d4880",
    "textInputs": [
      {
        "key": "property_name",
        "label": "Property Name",
        "maxLength": 40,
        "sample": "CEDAR COAST STAY",
        "required": true
      },
      {
        "key": "price_per_night",
        "label": "Price Per Night",
        "maxLength": 20,
        "sample": "$420 / NIGHT",
        "required": true
      },
      {
        "key": "features",
        "label": "Key Features",
        "maxLength": 60,
        "sample": "2 BEDROOMS | LOUNGE | KITCHEN",
        "required": true
      },
      {
        "key": "main_cta",
        "label": "Main Call to Action",
        "maxLength": 20,
        "sample": "BOOK YOUR STAY",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "main_image",
        "label": "Main Property Image",
        "required": true
      }
    ],
    "typography": {
      "features": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1,
        "lineHeight": 1.424,
        "tracking": 0,
        "align": "center",
        "color": "#c8c7c5",
        "fitScore": 0.615,
        "sampleBox": {
          "x": 0.0654296875,
          "y": 0.755859375,
          "width": 0.884765625,
          "height": 0.197265625
        },
        "sampleLineCount": 2,
        "detectionScore": 0.4
      },
      "property_name": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.4749163879598663,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#828fa8",
        "fitScore": 0.121,
        "sampleBox": {
          "x": 0.16455078125,
          "y": 0.11328125,
          "width": 0.6767578125,
          "height": 0.013671875
        },
        "sampleLineCount": 4,
        "detectionScore": 0.375,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      },
      "main_cta": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5194681861348525,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#b18053",
        "fitScore": 0.443,
        "sampleBox": {
          "x": 0.779296875,
          "y": 0.3046875,
          "width": 0.0556640625,
          "height": 0.028515625
        },
        "sampleLineCount": 4,
        "detectionScore": 0.357,
        "fontFile": "/fonts/adstudio/smooch-sans-400.woff2"
      },
      "price_per_night": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.214734950584007,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "left",
        "color": "#8f8b8e",
        "fitScore": 0.109,
        "sampleBox": {
          "x": 0.26708984375,
          "y": 0.123828125,
          "width": 0.60400390625,
          "height": 0.0359375
        },
        "sampleLineCount": 2,
        "detectionScore": 0.556,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-feed-163",
    "name": "Home Buying Process Q&A Engagement",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Potential buyers seeking information or clarity about the home buying process",
    "category": "engagement",
    "tags": [
      "home buying",
      "questions",
      "engagement",
      "buyer leads",
      "real estate"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-163-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_163.png",
    "sourceHash": "e68fdf0593a884a5ee9661eea428a717e8623a9d7667dfbb0cdb993250715503",
    "textInputs": [
      {
        "key": "main_question",
        "label": "Main Question",
        "maxLength": 100,
        "sample": "What would make your first home search feel clearer?",
        "required": true
      },
      {
        "key": "cta_text",
        "label": "Call to Action",
        "maxLength": 60,
        "sample": "Share your question below",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "agent_photo",
        "label": "Agent Photo",
        "required": true,
        "box": {
          "x": 0.4130859375,
          "y": 0.21640625,
          "width": 0.16796875,
          "height": 0.134375
        }
      }
    ],
    "typography": {
      "main_question": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.032258064516129,
        "lineHeight": 1.424,
        "tracking": 0,
        "align": "center",
        "color": "#232323",
        "fitScore": 0.569,
        "sampleBox": {
          "x": 0.2001953125,
          "y": 0.3890625,
          "width": 0.62646484375,
          "height": 0.191796875
        },
        "sampleLineCount": 3,
        "detectionScore": 1
      },
      "cta_text": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.6,
        "lineHeight": 1.2,
        "tracking": 0.02,
        "align": "center",
        "color": "#232323",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.8,
          "width": 0.8,
          "height": 0.05
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-feed-165",
    "name": "Japandi Apartment Rental Ad",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "People looking to rent a stylish, modern apartment",
    "category": "property_listing",
    "tags": [
      "apartment",
      "rental",
      "Japandi",
      "modern",
      "interior",
      "two bedroom"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-165-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_165.png",
    "sourceHash": "5c69e93a6b2d9ce1bd86dce78f6c0ef6d1bcd84506bde6066dd9b6eeb901b123",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 30,
        "sample": "CALM CITY APARTMENT",
        "required": true
      },
      {
        "key": "price_info",
        "label": "Starting Price",
        "maxLength": 30,
        "sample": "FROM $680 / WEEK",
        "required": true
      },
      {
        "key": "feature_1",
        "label": "Feature 1",
        "maxLength": 20,
        "sample": "QUIET LOUNGE",
        "required": true
      },
      {
        "key": "feature_2",
        "label": "Feature 2",
        "maxLength": 20,
        "sample": "2 BEDROOMS",
        "required": true
      },
      {
        "key": "feature_3",
        "label": "Feature 3",
        "maxLength": 20,
        "sample": "CITY VIEWS",
        "required": true
      },
      {
        "key": "website",
        "label": "Website or Contact Info",
        "maxLength": 50,
        "sample": "CEDARCOAST.EXAMPLE",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "main_image",
        "label": "Main Apartment Photo",
        "required": true
      }
    ],
    "typography": {
      "headline": {
        "fontId": "montserrat",
        "family": "Montserrat",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3544303797468353,
        "lineHeight": 1.219,
        "tracking": 0,
        "align": "center",
        "color": "#402f1f",
        "fitScore": 0.298,
        "sampleBox": {
          "x": 0.21630859375,
          "y": 0.695703125,
          "width": 0.58935546875,
          "height": 0.07265625
        },
        "sampleLineCount": 3,
        "detectionScore": 0.421,
        "fontFile": "/fonts/adstudio/montserrat-900.woff2"
      },
      "price_info": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 400,
        "italic": false,
        "case": "upper",
        "sizeRatio": 0.9552238805970149,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#b2a394",
        "fitScore": 0.474,
        "sampleBox": {
          "x": 0.2841796875,
          "y": 0.665234375,
          "width": 0.3603515625,
          "height": 0.044140625
        },
        "sampleLineCount": 1,
        "detectionScore": 0.462,
        "fontFile": "/fonts/adstudio/merriweather-400.woff2"
      },
      "feature_1": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 500,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "center",
        "color": "#66594b",
        "fitScore": 0.406,
        "sampleBox": {
          "x": 0.2021484375,
          "y": 0.752734375,
          "width": 0.62646484375,
          "height": 0.048046875
        },
        "sampleLineCount": 3,
        "detectionScore": 0.667,
        "fontFile": "/fonts/adstudio/oswald-500.woff2"
      },
      "feature_2": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3230490018148817,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "center",
        "color": "#e2dfda",
        "fitScore": 0.41,
        "sampleBox": {
          "x": 0.4287109375,
          "y": 0.775390625,
          "width": 0.1708984375,
          "height": 0.018359375
        },
        "sampleLineCount": 1,
        "detectionScore": 0.8,
        "fontFile": "/fonts/adstudio/manrope-700.woff2"
      },
      "feature_3": {
        "fontId": "montserrat",
        "family": "Montserrat",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "mixed",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.5,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#402f1f",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.6,
          "width": 0.8,
          "height": 0.06
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/montserrat-900.woff2"
      },
      "website": {
        "fontId": "montserrat",
        "family": "Montserrat",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "lower",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.45,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#402f1f",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.95,
          "width": 0.8,
          "height": 0.025
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/montserrat-900.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-feed-173",
    "name": "New Location Coming Soon Announcement",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Inform buyers about a new residential development launching soon in the city.",
    "category": "new_development",
    "tags": [
      "coming soon",
      "new location",
      "property launch",
      "buyer interest",
      "modern apartments"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-173-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_173.png",
    "sourceHash": "62af7a0e093d06a1eda25d187c05fafad4db95a82523f714dcfcffba44aa68cc",
    "textInputs": [
      {
        "key": "headline_top",
        "label": "Headline Top",
        "maxLength": 30,
        "sample": "NEW LOCATION",
        "required": true
      },
      {
        "key": "main_headline",
        "label": "Main Headline",
        "maxLength": 30,
        "sample": "COMING SOON !",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 100,
        "sample": "Elevate your living.\nA new destination is rising in the heart of the city",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "main_property_image",
        "label": "Main Property Image",
        "required": true,
        "box": {
          "x": 0,
          "y": 0.53515625,
          "width": 1,
          "height": 0.46484375
        }
      }
    ],
    "typography": {
      "subheadline": {
        "fontId": "fira-sans",
        "family": "Fira Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 0.7094972067039106,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#e7e8de",
        "fitScore": 0.527,
        "sampleBox": {
          "x": 0.11083984375,
          "y": 0.471875,
          "width": 0.33251953125,
          "height": 0.087109375
        },
        "sampleLineCount": 3,
        "detectionScore": 0.958,
        "fontFile": "/fonts/adstudio/fira-sans-300.woff2"
      },
      "main_headline": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.1851852239129719,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "left",
        "color": "#fbfbfa",
        "fitScore": 0.311,
        "sampleBox": {
          "x": 0.10791015625,
          "y": 0.147265625,
          "width": 0.48193359375,
          "height": 0.149609375
        },
        "sampleLineCount": 1,
        "detectionScore": 0.545,
        "fontFile": "/fonts/adstudio/oswald-400.woff2"
      },
      "headline_top": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5512820512820513,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#f2f2ec",
        "fitScore": 0.382,
        "sampleBox": {
          "x": 0.1171875,
          "y": 0.07578125,
          "width": 0.26318359375,
          "height": 0.05234375
        },
        "sampleLineCount": 1,
        "detectionScore": 0.917,
        "fontFile": "/fonts/adstudio/smooch-sans-400.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-feed-179",
    "name": "3 Reasons To Buy A House In Your Early 20s",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Young adults considering their first home purchase",
    "category": "education",
    "tags": [
      "first home",
      "young buyers",
      "reasons to buy",
      "real estate advice"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-179-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_179.png",
    "sourceHash": "2e09d7c15fb81cfb38591c945f5f2f24aac492b26cce2149e4274119efbb8cbc",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 30,
        "sample": "4 QUESTIONS",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 30,
        "sample": "BEFORE YOU BUY",
        "required": true
      },
      {
        "key": "caption",
        "label": "Caption",
        "maxLength": 30,
        "sample": "for a clearer first step",
        "required": false
      }
    ],
    "imageInputs": [
      {
        "key": "main_image",
        "label": "Main Image",
        "required": true,
        "box": {
          "x": 0.232421875,
          "y": 0.271875,
          "width": 0.53515625,
          "height": 0.4609375
        }
      }
    ],
    "typography": {
      "caption": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 500,
        "italic": false,
        "case": "lower",
        "sizeRatio": 0.9268292682926829,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#767676",
        "fitScore": 0.72,
        "sampleBox": {
          "x": 0.34765625,
          "y": 0.87421875,
          "width": 0.32177734375,
          "height": 0.0265625
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-500.woff2"
      },
      "subheadline": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.185185157423906,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "center",
        "color": "#b0b1a2",
        "fitScore": 0.295,
        "sampleBox": {
          "x": 0.19775390625,
          "y": 0.637890625,
          "width": 0.62451171875,
          "height": 0.193359375
        },
        "sampleLineCount": 3,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-700.woff2"
      },
      "headline": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.0163934426229508,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "center",
        "color": "#5f5e5e",
        "fitScore": 0.784,
        "sampleBox": {
          "x": 0.138671875,
          "y": 0.12578125,
          "width": 0.74072265625,
          "height": 0.084375
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-300.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-feed-188",
    "name": "Under Contract Just Sold Announcement",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Showcase a property that is under contract and just sold to attract potential sellers.",
    "category": "just_sold",
    "tags": [
      "under contract",
      "just sold",
      "seller leads",
      "property marketing",
      "real estate"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-188-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_188.png",
    "sourceHash": "e746739b1e5f57dd69a58fcf3b5a583eb1964b470e578b5dfd79b1533788341a",
    "textInputs": [
      {
        "key": "main_heading",
        "label": "Main Heading",
        "maxLength": 30,
        "sample": "UNDER CONTRACT",
        "required": true
      },
      {
        "key": "badge_text",
        "label": "Badge Text",
        "maxLength": 15,
        "sample": "JUST SOLD",
        "required": true
      },
      {
        "key": "contact_phone",
        "label": "Contact Phone",
        "maxLength": 20,
        "sample": "+123-555-0143",
        "required": true
      },
      {
        "key": "contact_handle",
        "label": "Contact Handle",
        "maxLength": 30,
        "sample": "@harbourline.example",
        "required": true
      },
      {
        "key": "price",
        "label": "Price",
        "maxLength": 20,
        "sample": "$695,000",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property Photo",
        "required": true,
        "box": {
          "x": 0,
          "y": 0,
          "width": 1,
          "height": 1
        }
      }
    ],
    "typography": {
      "contact_handle": {
        "fontId": "poppins",
        "family": "Poppins",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "lower",
        "sizeRatio": 0.9529411764705882,
        "lineHeight": 1.5,
        "tracking": 0,
        "align": "left",
        "color": "#eaedec",
        "fitScore": 0.734,
        "sampleBox": {
          "x": 0.14013671875,
          "y": 0.31015625,
          "width": 0.39990234375,
          "height": 0.025
        },
        "sampleLineCount": 1,
        "detectionScore": 0.864,
        "fontFile": "/fonts/adstudio/poppins-700.woff2"
      },
      "main_heading": {
        "fontId": "barlow-condensed",
        "family": "Barlow Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3617020807214912,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#677774",
        "fitScore": 0.252,
        "sampleBox": {
          "x": 0.0966796875,
          "y": 0.095703125,
          "width": 0.4638671875,
          "height": 0.1203125
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/barlow-condensed-800.woff2"
      },
      "contact_phone": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.1893463230672532,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "left",
        "color": "#eeefef",
        "fitScore": 0.715,
        "sampleBox": {
          "x": 0.20458984375,
          "y": 0.27578125,
          "width": 0.2265625,
          "height": 0.019140625
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-700.woff2"
      },
      "price": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 500,
        "italic": false,
        "case": "none",
        "sizeRatio": 0.9428571428571428,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "left",
        "color": "#f1f2f1",
        "fitScore": 0.542,
        "sampleBox": {
          "x": 0.65234375,
          "y": 0.284765625,
          "width": 0.259765625,
          "height": 0.0453125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-500.woff2"
      },
      "badge_text": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.55,
        "lineHeight": 1.2,
        "tracking": 0.03,
        "align": "center",
        "color": "#eaedec",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.05,
          "width": 0.8,
          "height": 0.035
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/oswald-300.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-feed-196",
    "name": "House For Rent - Modern Spacious Home",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Families or individuals seeking a modern, comfortable rental home in a prime location.",
    "category": "property_rental",
    "tags": [
      "house for rent",
      "modern home",
      "property rental",
      "family home",
      "spacious design"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-196-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_196.png",
    "sourceHash": "3e79bb4507c70b4e79ed826a21261dc7c97bfa5459c7fe5a9df08500b980b00f",
    "textInputs": [
      {
        "key": "agency_name",
        "label": "Agency Name",
        "maxLength": 30,
        "sample": "Oakmont Property",
        "required": true
      },
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 30,
        "sample": "HOUSE FOR RENT",
        "required": true
      },
      {
        "key": "description",
        "label": "Description",
        "maxLength": 200,
        "sample": "Modern family home for rent - spacious design in a prime location, perfect for comfortable everyday living.",
        "required": true
      },
      {
        "key": "features",
        "label": "Key Features",
        "maxLength": 100,
        "sample": "Dining Room, Living Room, Kitchen, Bedroom",
        "required": false
      },
      {
        "key": "contact_phone",
        "label": "Contact Phone",
        "maxLength": 20,
        "sample": "+123-555-0161",
        "required": true
      },
      {
        "key": "contact_email",
        "label": "Contact Email",
        "maxLength": 40,
        "sample": "hello@oakmont.example",
        "required": true
      },
      {
        "key": "cta_button",
        "label": "Call To Action Button",
        "maxLength": 20,
        "sample": "BOOK NOW",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "main_property_image",
        "label": "Main Property Image",
        "required": true,
        "box": {
          "x": 0.16018518518518518,
          "y": 0.18444444444444444,
          "width": 0.7166666666666667,
          "height": 0.5525925925925926
        }
      }
    ],
    "typography": {
      "description": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.116332165233089,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#c3c6ca",
        "fitScore": 0.249,
        "sampleBox": {
          "x": 0.12646484375,
          "y": 0.365625,
          "width": 0.7177734375,
          "height": 0.09765625
        },
        "sampleLineCount": 9,
        "detectionScore": 0.912,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      },
      "features": {
        "fontId": "titillium-web",
        "family": "Titillium Web",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 0.9642857142857143,
        "lineHeight": 1.521,
        "tracking": 0,
        "align": "center",
        "color": "#b4cfdb",
        "fitScore": 0.207,
        "sampleBox": {
          "x": 0.2373046875,
          "y": 0.79140625,
          "width": 0.56640625,
          "height": 0.0109375
        },
        "sampleLineCount": 4,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/titillium-web-900.woff2"
      },
      "contact_email": {
        "fontId": "raleway",
        "family": "Raleway",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.0890756302521007,
        "lineHeight": 1.174,
        "tracking": 0,
        "align": "left",
        "color": "#585754",
        "fitScore": 0.74,
        "sampleBox": {
          "x": 0.5107421875,
          "y": 0.9171875,
          "width": 0.26953125,
          "height": 0.025
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/raleway-600.woff2"
      },
      "agency_name": {
        "fontId": "outfit",
        "family": "Outfit",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0717165898617511,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "left",
        "color": "#68818b",
        "fitScore": 0.722,
        "sampleBox": {
          "x": 0.078125,
          "y": 0.08359375,
          "width": 0.5322265625,
          "height": 0.041796875
        },
        "sampleLineCount": 4,
        "detectionScore": 0.8,
        "fontFile": "/fonts/adstudio/outfit-600.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238095899101858,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#35322d",
        "fitScore": 0.518,
        "sampleBox": {
          "x": 0.12890625,
          "y": 0.20234375,
          "width": 0.34326171875,
          "height": 0.1359375
        },
        "sampleLineCount": 2,
        "detectionScore": 0.857,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "contact_phone": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.5057030983997277,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "left",
        "color": "#dfdfde",
        "fitScore": 0.191,
        "sampleBox": {
          "x": 0.30517578125,
          "y": 0.818359375,
          "width": 0.517578125,
          "height": 0.08984375
        },
        "sampleLineCount": 5,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      },
      "cta_button": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.6,
        "lineHeight": 1.2,
        "tracking": 0.02,
        "align": "center",
        "color": "#c3c6ca",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.8,
          "width": 0.8,
          "height": 0.05
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/kanit-300.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-feed-197",
    "name": "Notes for First Time Home Buyers",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Attract and educate first time home buyers with practical tips",
    "category": "buyer_education",
    "tags": [
      "first time buyers",
      "home buying tips",
      "real estate advice",
      "buyer leads"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-feed-197-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_197.png",
    "sourceHash": "3096e3d51610baab87bb2d4145f4dc102b77496c5b902d8ec4b1b7c5e22476aa",
    "textInputs": [
      {
        "key": "search_bar_text",
        "label": "Search Bar Text",
        "maxLength": 40,
        "sample": "First home in Perth",
        "required": true
      },
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 40,
        "sample": "Notes for First Home Buyers",
        "required": true
      },
      {
        "key": "tip_1",
        "label": "Tip 1",
        "maxLength": 30,
        "sample": "Prioritise your needs",
        "required": true
      },
      {
        "key": "tip_2",
        "label": "Tip 2",
        "maxLength": 30,
        "sample": "Choose your home type",
        "required": true
      },
      {
        "key": "tip_3",
        "label": "Tip 3",
        "maxLength": 30,
        "sample": "Compare loan options",
        "required": true
      },
      {
        "key": "tip_4",
        "label": "Tip 4",
        "maxLength": 30,
        "sample": "Research the location",
        "required": true
      },
      {
        "key": "tip_5",
        "label": "Tip 5",
        "maxLength": 30,
        "sample": "Set a comfortable budget",
        "required": true
      },
      {
        "key": "handle",
        "label": "Contact or Handle",
        "maxLength": 30,
        "sample": "@homeguide.example",
        "required": false
      }
    ],
    "imageInputs": [
      {
        "key": "main_image",
        "label": "Background Living Room Photo",
        "required": true
      }
    ],
    "typography": {
      "headline": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.1228070350978308,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#beb6af",
        "fitScore": 0.254,
        "sampleBox": {
          "x": 0.00634765625,
          "y": 0.205078125,
          "width": 0.9873046875,
          "height": 0.330078125
        },
        "sampleLineCount": 12,
        "detectionScore": 0.63,
        "fontFile": "/fonts/adstudio/kanit-800.woff2"
      },
      "tip_5": {
        "fontId": "libre-franklin",
        "family": "Libre Franklin",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.09297520661157,
        "lineHeight": 1.212,
        "tracking": 0,
        "align": "left",
        "color": "#302f30",
        "fitScore": 0.482,
        "sampleBox": {
          "x": 0.5419921875,
          "y": 0.806640625,
          "width": 0.21728515625,
          "height": 0.015234375
        },
        "sampleLineCount": 1,
        "detectionScore": 0.708,
        "fontFile": "/fonts/adstudio/libre-franklin-800.woff2"
      },
      "tip_1": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 0.9445562262463671,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#888888",
        "fitScore": 0.719,
        "sampleBox": {
          "x": 0.15673828125,
          "y": 0.653125,
          "width": 0.7109375,
          "height": 0.04453125
        },
        "sampleLineCount": 3,
        "detectionScore": 0.545,
        "fontFile": "/fonts/adstudio/merriweather-300.woff2"
      },
      "tip_2": {
        "fontId": "roboto",
        "family": "Roboto",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.108374384236453,
        "lineHeight": 1.171875,
        "tracking": 0,
        "align": "left",
        "color": "#343434",
        "fitScore": 0.837,
        "sampleBox": {
          "x": 0.14501953125,
          "y": 0.702734375,
          "width": 0.42626953125,
          "height": 0.0203125
        },
        "sampleLineCount": 2,
        "detectionScore": 0.524,
        "fontFile": "/fonts/adstudio/roboto-700.woff2"
      },
      "tip_4": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.1428571428571428,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#323233",
        "fitScore": 0.418,
        "sampleBox": {
          "x": 0.27490234375,
          "y": 0.83203125,
          "width": 0.140625,
          "height": 0.015625
        },
        "sampleLineCount": 1,
        "detectionScore": 0.571,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "tip_3": {
        "fontId": "roboto",
        "family": "Roboto",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.108374384236453,
        "lineHeight": 1.171875,
        "tracking": 0,
        "align": "left",
        "color": "#323232",
        "fitScore": 0.573,
        "sampleBox": {
          "x": 0.71044921875,
          "y": 0.67734375,
          "width": 0.171875,
          "height": 0.0203125
        },
        "sampleLineCount": 1,
        "detectionScore": 0.6,
        "fontFile": "/fonts/adstudio/roboto-700.woff2"
      },
      "search_bar_text": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.1666666666666667,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#404040",
        "fitScore": 0.474,
        "sampleBox": {
          "x": 0.23095703125,
          "y": 0.1015625,
          "width": 0.19873046875,
          "height": 0.01328125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "handle": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.0012771392081736,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "center",
        "color": "#464646",
        "fitScore": 0.618,
        "sampleBox": {
          "x": 0.3779296875,
          "y": 0.9140625,
          "width": 0.2451171875,
          "height": 0.01875
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-600.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-investor-consult-story-280",
    "name": "Rental Appraisal \u2014 Story 280",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Property investors and landlords seeking current rental guidance",
    "category": "investor-lead-generation",
    "tags": [
      "rental-appraisal",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-investor-consult-story-280-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_280.png",
    "sourceHash": "734493860d8f77ea56d93cfc13019004ceb32e2b5c8c14bd9f90ba71ad7db3ce",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 52,
        "sample": "WHAT COULD YOUR PROPERTY RENT FOR?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 44,
        "sample": "REQUEST A RENTAL APPRAISAL",
        "required": true
      },
      {
        "key": "benefit_1",
        "label": "Benefit 1",
        "maxLength": 30,
        "sample": "CURRENT RENT",
        "required": true
      },
      {
        "key": "benefit_2",
        "label": "Benefit 2",
        "maxLength": 31,
        "sample": "TENANT DEMAND",
        "required": true
      },
      {
        "key": "benefit_3",
        "label": "Benefit 3",
        "maxLength": 35,
        "sample": "INVESTOR GUIDANCE",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 41,
        "sample": "BOOK A RENTAL APPRAISAL",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "background_photo",
        "label": "Background photo",
        "required": true
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true
      }
    ],
    "typography": {
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.523809483812699,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#4d5055",
        "fitScore": 0.516,
        "sampleBox": {
          "x": 0.1037037037037037,
          "y": 0.18697916666666667,
          "width": 0.6337962962962963,
          "height": 0.14765625
        },
        "sampleLineCount": 3,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "open-sans",
        "family": "Open Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.1418918918918919,
        "lineHeight": 1.36181640625,
        "tracking": 0,
        "align": "left",
        "color": "#565a5e",
        "fitScore": 0.56,
        "sampleBox": {
          "x": 0.10740740740740741,
          "y": 0.3536458333333333,
          "width": 0.6231481481481481,
          "height": 0.018489583333333334
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/open-sans-600.woff2"
      },
      "cta": {
        "fontId": "cairo",
        "family": "Cairo",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.4206230529595014,
        "lineHeight": 1.874,
        "tracking": 0,
        "align": "center",
        "color": "#2b3d44",
        "fitScore": 0.23,
        "sampleBox": {
          "x": 0.2125,
          "y": 0.8989583333333333,
          "width": 0.5773148148148148,
          "height": 0.06822916666666666
        },
        "sampleLineCount": 1,
        "detectionScore": 0.87,
        "fontFile": "/fonts/adstudio/cairo-900.woff2"
      },
      "benefit_3": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.32,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#4c4c4c",
        "fitScore": 0.401,
        "sampleBox": {
          "x": 0.24953703703703703,
          "y": 0.6268229166666667,
          "width": 0.35555555555555557,
          "height": 0.015104166666666667
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-700.woff2"
      },
      "benefit_2": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.309462915601023,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#5b5b5d",
        "fitScore": 0.402,
        "sampleBox": {
          "x": 0.2462962962962963,
          "y": 0.5354166666666667,
          "width": 0.2949074074074074,
          "height": 0.014583333333333334
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-700.woff2"
      },
      "benefit_1": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.528301886792453,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#626568",
        "fitScore": 0.735,
        "sampleBox": {
          "x": 0.12314814814814815,
          "y": 0.4309895833333333,
          "width": 0.38796296296296295,
          "height": 0.03723958333333333
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-lead-checklist-feed-157",
    "name": "Free Property Checklist \u2014 Feed 157",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Property owners seeking practical guidance before their next move",
    "category": "educational-lead-generation",
    "tags": [
      "education",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-lead-checklist-feed-157-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_157.png",
    "sourceHash": "9b6e5b39b6aeb5e9bf15d5e180d435ff4dda3b331144535d8651f905517dbc19",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 50,
        "sample": "FREE PROPERTY PLANNING CHECKLIST",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 45,
        "sample": "MAKE YOUR NEXT MOVE CLEARER",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 98,
        "sample": "Get a practical checklist covering preparation, timing and the questions to ask.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 40,
        "sample": "GET THE FREE CHECKLIST",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "background_photo",
        "label": "Background photo",
        "required": true
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "quicksand",
        "family": "Quicksand",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0673959068454482,
        "lineHeight": 1.25,
        "tracking": 0,
        "align": "left",
        "color": "#4f4f50",
        "fitScore": 0.578,
        "sampleBox": {
          "x": 0.1986111111111111,
          "y": 0.6166666666666667,
          "width": 0.3907407407407407,
          "height": 0.07148148148148148
        },
        "sampleLineCount": 3,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/quicksand-300.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238096042808835,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#212224",
        "fitScore": 0.59,
        "sampleBox": {
          "x": 0.10833333333333334,
          "y": 0.3414814814814815,
          "width": 0.8537037037037037,
          "height": 0.19666666666666666
        },
        "sampleLineCount": 5,
        "detectionScore": 0.886,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "titillium-web",
        "family": "Titillium Web",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.4313725490196079,
        "lineHeight": 1.521,
        "tracking": 0,
        "align": "right",
        "color": "#deddda",
        "fitScore": 0.253,
        "sampleBox": {
          "x": 0.1398148148148148,
          "y": 0.49703703703703705,
          "width": 0.8601851851851852,
          "height": 0.0937037037037037
        },
        "sampleLineCount": 3,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/titillium-web-900.woff2"
      },
      "cta": {
        "fontId": "quicksand",
        "family": "Quicksand",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.65,
        "lineHeight": 1.2,
        "tracking": 0.02,
        "align": "center",
        "color": "#4f4f50",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.78,
          "width": 0.8,
          "height": 0.05
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/quicksand-300.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-lead-checklist-feed-175",
    "name": "Free Property Checklist \u2014 Feed 175",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Property owners seeking practical guidance before their next move",
    "category": "educational-lead-generation",
    "tags": [
      "education",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-lead-checklist-feed-175-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_175.png",
    "sourceHash": "3d3d5f69f07ddd969642bf29599af92075c1bdae063c76359e7fb8d634640756",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 50,
        "sample": "FREE PROPERTY PLANNING CHECKLIST",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 45,
        "sample": "MAKE YOUR NEXT MOVE CLEARER",
        "required": true
      },
      {
        "key": "check_1",
        "label": "Check 1",
        "maxLength": 39,
        "sample": "PREPARE YOUR PROPERTY",
        "required": true
      },
      {
        "key": "check_2",
        "label": "Check 2",
        "maxLength": 40,
        "sample": "UNDERSTAND YOUR TIMING",
        "required": true
      },
      {
        "key": "check_3",
        "label": "Check 3",
        "maxLength": 41,
        "sample": "REVIEW LOCAL CONDITIONS",
        "required": true
      },
      {
        "key": "check_4",
        "label": "Check 4",
        "maxLength": 38,
        "sample": "COMPARE YOUR OPTIONS",
        "required": true
      },
      {
        "key": "check_5",
        "label": "Check 5",
        "maxLength": 38,
        "sample": "ASK BETTER QUESTIONS",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 40,
        "sample": "GET THE FREE CHECKLIST",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "background_photo",
        "label": "Background photo",
        "required": true,
        "box": {
          "x": 0,
          "y": 0,
          "width": 1,
          "height": 0.4614814814814815
        }
      },
      {
        "key": "agent_portrait",
        "label": "Agent portrait",
        "required": true,
        "box": {
          "x": 0.6351851851851852,
          "y": 0.06296296296296296,
          "width": 0.31666666666666665,
          "height": 0.3985185185185185
        }
      }
    ],
    "typography": {
      "headline": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.279999948000002,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "center",
        "color": "#7d7a76",
        "fitScore": 0.335,
        "sampleBox": {
          "x": 0.002777777777777778,
          "y": 0.17925925925925926,
          "width": 0.9768518518518519,
          "height": 0.16
        },
        "sampleLineCount": 12,
        "detectionScore": 0.568,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-600.woff2"
      },
      "subheadline": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.4915254237288134,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#7d7876",
        "fitScore": 0.43,
        "sampleBox": {
          "x": 0.07731481481481481,
          "y": 0.3337037037037037,
          "width": 0.8115740740740741,
          "height": 0.056666666666666664
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      },
      "check_3": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.500709219858156,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#5b544d",
        "fitScore": 0.513,
        "sampleBox": {
          "x": 0.20092592592592592,
          "y": 0.6666666666666666,
          "width": 0.4685185185185185,
          "height": 0.03
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-600.woff2"
      },
      "check_2": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5121951219512195,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#59524b",
        "fitScore": 0.728,
        "sampleBox": {
          "x": 0.20092592592592592,
          "y": 0.5922222222222222,
          "width": 0.4708333333333333,
          "height": 0.04
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-400.woff2"
      },
      "check_1": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3236914600550966,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "left",
        "color": "#575049",
        "fitScore": 0.397,
        "sampleBox": {
          "x": 0.20092592592592592,
          "y": 0.5144444444444445,
          "width": 0.4351851851851852,
          "height": 0.02
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-800.woff2"
      },
      "check_4": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3236914600550966,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "left",
        "color": "#554f48",
        "fitScore": 0.405,
        "sampleBox": {
          "x": 0.20046296296296295,
          "y": 0.7437037037037038,
          "width": 0.42083333333333334,
          "height": 0.020370370370370372
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-800.woff2"
      },
      "check_5": {
        "fontId": "nunito-sans",
        "family": "Nunito Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.0677777777777782,
        "lineHeight": 1.364,
        "tracking": 0,
        "align": "left",
        "color": "#575049",
        "fitScore": 0.5,
        "sampleBox": {
          "x": 0.19953703703703704,
          "y": 0.8203703703703704,
          "width": 0.4050925925925926,
          "height": 0.02
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/nunito-sans-800.woff2"
      },
      "cta": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.65,
        "lineHeight": 1.2,
        "tracking": 0.02,
        "align": "center",
        "color": "#575049",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.78,
          "width": 0.8,
          "height": 0.05
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-lead-checklist-story-304",
    "name": "Free Property Checklist \u2014 Story 304",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Property owners seeking practical guidance before their next move",
    "category": "educational-lead-generation",
    "tags": [
      "education",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-lead-checklist-story-304-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_304.png",
    "sourceHash": "15db4d72f3b3af099d5555e5271a0f1cccd86d65068a4f7e2257742f1fcb1597",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 50,
        "sample": "FREE PROPERTY PLANNING CHECKLIST",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 45,
        "sample": "MAKE YOUR NEXT MOVE CLEARER",
        "required": true
      },
      {
        "key": "benefit_1",
        "label": "Benefit 1",
        "maxLength": 35,
        "sample": "PREPARE YOUR HOME",
        "required": true
      },
      {
        "key": "benefit_2",
        "label": "Benefit 2",
        "maxLength": 35,
        "sample": "UNDERSTAND TIMING",
        "required": true
      },
      {
        "key": "benefit_3",
        "label": "Benefit 3",
        "maxLength": 38,
        "sample": "ASK BETTER QUESTIONS",
        "required": true
      },
      {
        "key": "check_1",
        "label": "Check 1",
        "maxLength": 39,
        "sample": "PREPARE YOUR PROPERTY",
        "required": true
      },
      {
        "key": "check_2",
        "label": "Check 2",
        "maxLength": 40,
        "sample": "UNDERSTAND YOUR TIMING",
        "required": true
      },
      {
        "key": "check_3",
        "label": "Check 3",
        "maxLength": 41,
        "sample": "REVIEW LOCAL CONDITIONS",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 40,
        "sample": "GET THE FREE CHECKLIST",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "background_photo",
        "label": "Background photo",
        "required": true,
        "box": {
          "x": 0,
          "y": 0,
          "width": 1,
          "height": 1
        }
      }
    ],
    "typography": {
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.52380961018962,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#445369",
        "fitScore": 0.342,
        "sampleBox": {
          "x": 0.08333333333333333,
          "y": 0.06276041666666667,
          "width": 0.6884259259259259,
          "height": 0.25755208333333335
        },
        "sampleLineCount": 4,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 500,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3121924548933843,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#7b8286",
        "fitScore": 0.412,
        "sampleBox": {
          "x": 0.1550925925925926,
          "y": 0.34479166666666666,
          "width": 0.4476851851851852,
          "height": 0.05416666666666667
        },
        "sampleLineCount": 2,
        "detectionScore": 0.704,
        "fontFile": "/fonts/adstudio/merriweather-500.woff2"
      },
      "check_3": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2884615384615385,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#202c41",
        "fitScore": 0.608,
        "sampleBox": {
          "x": 0.18518518518518517,
          "y": 0.7760416666666666,
          "width": 0.5740740740740741,
          "height": 0.030729166666666665
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-600.woff2"
      },
      "check_2": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3265306122448979,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "center",
        "color": "#1e2b40",
        "fitScore": 0.613,
        "sampleBox": {
          "x": 0.18564814814814815,
          "y": 0.715625,
          "width": 0.5625,
          "height": 0.029947916666666668
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-600.woff2"
      },
      "cta": {
        "fontId": "poppins",
        "family": "Poppins",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3704836334805752,
        "lineHeight": 1.5,
        "tracking": 0,
        "align": "center",
        "color": "#3b4b61",
        "fitScore": 0.242,
        "sampleBox": {
          "x": 0.1935185185185185,
          "y": 0.86953125,
          "width": 0.612037037037037,
          "height": 0.05
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/poppins-900.woff2"
      },
      "check_1": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3403076923076924,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "center",
        "color": "#202c42",
        "fitScore": 0.624,
        "sampleBox": {
          "x": 0.18472222222222223,
          "y": 0.6546875,
          "width": 0.5430555555555555,
          "height": 0.03046875
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-600.woff2"
      },
      "benefit_3": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.0138888888888888,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "left",
        "color": "#4a515e",
        "fitScore": 0.612,
        "sampleBox": {
          "x": 0.09444444444444444,
          "y": 0.51875,
          "width": 0.5689814814814815,
          "height": 0.06588541666666667
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-400.woff2"
      },
      "benefit_1": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3257575757575757,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "left",
        "color": "#4a5364",
        "fitScore": 0.337,
        "sampleBox": {
          "x": 0.22407407407407406,
          "y": 0.41692708333333334,
          "width": 0.4041666666666667,
          "height": 0.01640625
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-700.woff2"
      },
      "benefit_2": {
        "fontId": "lato",
        "family": "Lato",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.4012121212121211,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#858a94",
        "fitScore": 0.243,
        "sampleBox": {
          "x": 0.22407407407407406,
          "y": 0.48489583333333336,
          "width": 0.39305555555555555,
          "height": 0.015885416666666666
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/lato-900.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-lead-checklist-story-316",
    "name": "Free Property Checklist \u2014 Story 316",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Property owners seeking practical guidance before their next move",
    "category": "educational-lead-generation",
    "tags": [
      "education",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-lead-checklist-story-316-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_316.png",
    "sourceHash": "3220c9384dd6f8bc19bea23b86edc3215ab1132acf717f480c24b9e86d7fef2a",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 50,
        "sample": "FREE PROPERTY PLANNING CHECKLIST",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 45,
        "sample": "MAKE YOUR NEXT MOVE CLEARER",
        "required": true
      },
      {
        "key": "benefit_1",
        "label": "Benefit 1",
        "maxLength": 35,
        "sample": "PREPARE YOUR HOME",
        "required": true
      },
      {
        "key": "benefit_2",
        "label": "Benefit 2",
        "maxLength": 35,
        "sample": "UNDERSTAND TIMING",
        "required": true
      },
      {
        "key": "benefit_3",
        "label": "Benefit 3",
        "maxLength": 38,
        "sample": "ASK BETTER QUESTIONS",
        "required": true
      },
      {
        "key": "check_1",
        "label": "Check 1",
        "maxLength": 39,
        "sample": "PREPARE YOUR PROPERTY",
        "required": true
      },
      {
        "key": "check_2",
        "label": "Check 2",
        "maxLength": 40,
        "sample": "UNDERSTAND YOUR TIMING",
        "required": true
      },
      {
        "key": "check_3",
        "label": "Check 3",
        "maxLength": 41,
        "sample": "REVIEW LOCAL CONDITIONS",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 40,
        "sample": "GET THE FREE CHECKLIST",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "background_photo",
        "label": "Background photo",
        "required": true
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true
      }
    ],
    "typography": {
      "headline": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.1851852325840537,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "center",
        "color": "#bbbdbb",
        "fitScore": 0.294,
        "sampleBox": {
          "x": 0.08703703703703704,
          "y": 0.34270833333333334,
          "width": 0.8537037037037037,
          "height": 0.13958333333333334
        },
        "sampleLineCount": 4,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-300.woff2"
      },
      "subheadline": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3000949667616335,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#203849",
        "fitScore": 0.483,
        "sampleBox": {
          "x": 0.16944444444444445,
          "y": 0.53046875,
          "width": 0.6912037037037037,
          "height": 0.0171875
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "check_3": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3493253373313343,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "center",
        "color": "#243a4b",
        "fitScore": 0.46,
        "sampleBox": {
          "x": 0.25277777777777777,
          "y": 0.8841145833333334,
          "width": 0.4615740740740741,
          "height": 0.013802083333333333
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-800.woff2"
      },
      "check_2": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3493253373313343,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "center",
        "color": "#253c4d",
        "fitScore": 0.458,
        "sampleBox": {
          "x": 0.25277777777777777,
          "y": 0.8341145833333333,
          "width": 0.4537037037037037,
          "height": 0.013802083333333333
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-800.woff2"
      },
      "check_1": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3493253373313343,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "center",
        "color": "#253b4c",
        "fitScore": 0.453,
        "sampleBox": {
          "x": 0.25277777777777777,
          "y": 0.784375,
          "width": 0.425,
          "height": 0.013541666666666667
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-800.woff2"
      },
      "benefit_3": {
        "fontId": "roboto-condensed",
        "family": "Roboto Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.1322463768115942,
        "lineHeight": 1.171875,
        "tracking": 0,
        "align": "center",
        "color": "#31485a",
        "fitScore": 0.753,
        "sampleBox": {
          "x": 0.1486111111111111,
          "y": 0.6997395833333333,
          "width": 0.7180555555555556,
          "height": 0.0109375
        },
        "sampleLineCount": 2,
        "detectionScore": 0.6,
        "fontFile": "/fonts/adstudio/roboto-condensed-800.woff2"
      },
      "benefit_1": {
        "fontId": "lora",
        "family": "Lora",
        "fallbackFamily": "serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3456686291000843,
        "lineHeight": 1.28,
        "tracking": 0,
        "align": "left",
        "color": "#273f4f",
        "fitScore": 0.764,
        "sampleBox": {
          "x": 0.14722222222222223,
          "y": 0.7736979166666667,
          "width": 0.5300925925925926,
          "height": 0.036458333333333336
        },
        "sampleLineCount": 1,
        "detectionScore": 0.625,
        "fontFile": "/fonts/adstudio/lora-600.woff2"
      },
      "benefit_2": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3280763643909523,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "left",
        "color": "#273f50",
        "fitScore": 0.794,
        "sampleBox": {
          "x": 0.14722222222222223,
          "y": 0.8229166666666666,
          "width": 0.5587962962962963,
          "height": 0.036458333333333336
        },
        "sampleLineCount": 1,
        "detectionScore": 0.68,
        "fontFile": "/fonts/adstudio/manrope-600.woff2"
      },
      "cta": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 500,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.65,
        "lineHeight": 1.2,
        "tracking": 0.02,
        "align": "center",
        "color": "#bbbdbb",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.78,
          "width": 0.8,
          "height": 0.05
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-500.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-market-report-feed-139",
    "name": "Suburb Market Report \u2014 Feed 139",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Local homeowners seeking current suburb price and demand insights",
    "category": "market-report-lead-generation",
    "tags": [
      "market-report",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-market-report-feed-139-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_139.png",
    "sourceHash": "4d627695b6ee3ca05db7a3c263bdbb544860a95f49e672f148d0b1d8ed02b328",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 43,
        "sample": "YOUR SUBURB MARKET UPDATE",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 46,
        "sample": "LOCAL PRICES. CLEAR INSIGHT.",
        "required": true
      },
      {
        "key": "stat_1",
        "label": "Stat 1",
        "maxLength": 38,
        "sample": "CURRENT MEDIAN PRICE",
        "required": true
      },
      {
        "key": "stat_2",
        "label": "Stat 2",
        "maxLength": 30,
        "sample": "RECENT SALES",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 37,
        "sample": "GET THE FREE REPORT",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 30,
        "sample": "0400 123 456",
        "required": true
      },
      {
        "key": "email",
        "label": "Email",
        "maxLength": 40,
        "sample": "alex@youragency.com.au",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "suburb_aerial",
        "label": "Suburb aerial",
        "required": true,
        "box": {
          "x": 0.05462962962962963,
          "y": 0.40444444444444444,
          "width": 0.8907407407407407,
          "height": 0.33555555555555555
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.44814814814814813,
          "y": 0.04296296296296296,
          "width": 0.10277777777777777,
          "height": 0.08370370370370371
        }
      }
    ],
    "typography": {
      "subheadline": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3351648351648353,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#1b3345",
        "fitScore": 0.458,
        "sampleBox": {
          "x": 0.2851851851851852,
          "y": 0.2840740740740741,
          "width": 0.4666666666666667,
          "height": 0.017407407407407406
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-900.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238094911954372,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#102b3d",
        "fitScore": 0.515,
        "sampleBox": {
          "x": 0.18703703703703703,
          "y": 0.14888888888888888,
          "width": 0.6462962962962963,
          "height": 0.11444444444444445
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "email": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "lower",
        "sizeRatio": 0.9843915343915344,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "center",
        "color": "#233d52",
        "fitScore": 0.915,
        "sampleBox": {
          "x": 0.13842592592592592,
          "y": 0.9340740740740741,
          "width": 0.7226851851851852,
          "height": 0.03962962962962963
        },
        "sampleLineCount": 1,
        "detectionScore": 0.647,
        "fontFile": "/fonts/adstudio/oswald-600.woff2"
      },
      "stat_1": {
        "fontId": "libre-franklin",
        "family": "Libre Franklin",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3827160493827158,
        "lineHeight": 1.212,
        "tracking": 0,
        "align": "center",
        "color": "#e8e6dd",
        "fitScore": 0.676,
        "sampleBox": {
          "x": 0.2310185185185185,
          "y": 0.8181481481481482,
          "width": 0.5449074074074074,
          "height": 0.017777777777777778
        },
        "sampleLineCount": 2,
        "detectionScore": 0.7,
        "fontFile": "/fonts/adstudio/libre-franklin-900.woff2"
      },
      "cta": {
        "fontId": "mulish",
        "family": "Mulish",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.4361851332398317,
        "lineHeight": 1.255,
        "tracking": 0,
        "align": "center",
        "color": "#112d41",
        "fitScore": 0.422,
        "sampleBox": {
          "x": 0.2962962962962963,
          "y": 0.8951851851851852,
          "width": 0.42268518518518516,
          "height": 0.02148148148148148
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/mulish-900.woff2"
      },
      "stat_2": {
        "fontId": "roboto-slab",
        "family": "Roboto Slab",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.36992159657876,
        "lineHeight": 1.31884765625,
        "tracking": 0,
        "align": "center",
        "color": "#e1d9c5",
        "fitScore": 0.773,
        "sampleBox": {
          "x": 0.16898148148148148,
          "y": 0.7914814814814815,
          "width": 0.6324074074074074,
          "height": 0.04
        },
        "sampleLineCount": 2,
        "detectionScore": 0.667,
        "fontFile": "/fonts/adstudio/roboto-slab-800.woff2"
      },
      "phone": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.55,
        "lineHeight": 1.2,
        "tracking": 0.01,
        "align": "center",
        "color": "#1b3345",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.9,
          "width": 0.8,
          "height": 0.03
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/merriweather-300.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-market-report-feed-158",
    "name": "Suburb Market Report \u2014 Feed 158",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Local homeowners seeking current suburb price and demand insights",
    "category": "market-report-lead-generation",
    "tags": [
      "market-report",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-market-report-feed-158-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_158.png",
    "sourceHash": "482c522fe77b8482c61e4a65332b9045de278a5a3dd77ba1c062c83c4ae5cd47",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 43,
        "sample": "YOUR SUBURB MARKET UPDATE",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 46,
        "sample": "LOCAL PRICES. CLEAR INSIGHT.",
        "required": true
      },
      {
        "key": "stat_1",
        "label": "Stat 1",
        "maxLength": 38,
        "sample": "CURRENT MEDIAN PRICE",
        "required": true
      },
      {
        "key": "stat_2",
        "label": "Stat 2",
        "maxLength": 30,
        "sample": "RECENT SALES",
        "required": true
      },
      {
        "key": "stat_3",
        "label": "Stat 3",
        "maxLength": 32,
        "sample": "DAYS ON MARKET",
        "required": true
      },
      {
        "key": "stat_4",
        "label": "Stat 4",
        "maxLength": 30,
        "sample": "BUYER DEMAND",
        "required": true
      },
      {
        "key": "stat_5",
        "label": "Stat 5",
        "maxLength": 30,
        "sample": "NEW LISTINGS",
        "required": true
      },
      {
        "key": "stat_6",
        "label": "Stat 6",
        "maxLength": 30,
        "sample": "MARKET TREND",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "market_graphic",
        "label": "Market graphic",
        "required": true,
        "box": {
          "x": 0.014814814814814815,
          "y": 0.2,
          "width": 0.9703703703703703,
          "height": 0.3214814814814815
        }
      }
    ],
    "typography": {
      "headline": {
        "fontId": "roboto-condensed",
        "family": "Roboto Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "sizeRatio": 1.3337742504409171,
        "lineHeight": 1.171875,
        "tracking": 0,
        "align": "center",
        "color": "#1d1d1c",
        "fitScore": 0.498,
        "sampleBox": {
          "x": 0.10740740740740741,
          "y": 0.07555555555555556,
          "width": 0.8203703703703704,
          "height": 0.040740740740740744
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/roboto-condensed-800.woff2"
      },
      "stat_1": {
        "fontId": "overlock",
        "family": "Overlock",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "sizeRatio": 1.47,
        "lineHeight": 1.22,
        "tracking": 0,
        "align": "left",
        "color": "#3d3d3d",
        "fitScore": 0.312,
        "sampleBox": {
          "x": 0.0763888888888889,
          "y": 0.6966666666666667,
          "width": 0.2361111111111111,
          "height": 0.015555555555555555
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/overlock-900.woff2"
      },
      "stat_3": {
        "fontId": "overlock",
        "family": "Overlock",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "sizeRatio": 1.3125,
        "lineHeight": 1.22,
        "tracking": 0,
        "align": "left",
        "color": "#424242",
        "fitScore": 0.472,
        "sampleBox": {
          "x": 0.7037037037037037,
          "y": 0.6966666666666667,
          "width": 0.1685185185185185,
          "height": 0.015555555555555555
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/overlock-900.woff2"
      },
      "stat_2": {
        "fontId": "overlock",
        "family": "Overlock",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "sizeRatio": 1.47,
        "lineHeight": 1.22,
        "tracking": 0,
        "align": "center",
        "color": "#3b3b3b",
        "fitScore": 0.323,
        "sampleBox": {
          "x": 0.42453703703703705,
          "y": 0.6966666666666667,
          "width": 0.14166666666666666,
          "height": 0.015555555555555555
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/overlock-900.woff2"
      },
      "stat_4": {
        "fontId": "overlock",
        "family": "Overlock",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "sizeRatio": 1.3125,
        "lineHeight": 1.22,
        "tracking": 0,
        "align": "left",
        "color": "#3b3b3b",
        "fitScore": 0.467,
        "sampleBox": {
          "x": 0.11805555555555555,
          "y": 0.8937037037037037,
          "width": 0.15925925925925927,
          "height": 0.016296296296296295
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/overlock-900.woff2"
      },
      "stat_5": {
        "fontId": "museomoderno",
        "family": "MuseoModerno",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "sizeRatio": 1.105263157894737,
        "lineHeight": 1.59,
        "tracking": 0,
        "align": "center",
        "color": "#393a3a",
        "fitScore": 0.333,
        "sampleBox": {
          "x": 0.425462962962963,
          "y": 0.8937037037037037,
          "width": 0.14027777777777778,
          "height": 0.016296296296296295
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/museomoderno-900.woff2"
      },
      "stat_6": {
        "fontId": "elsie-swash-caps",
        "family": "Elsie Swash Caps",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "sizeRatio": 1.1278772378516624,
        "lineHeight": 1.152,
        "tracking": 0,
        "align": "left",
        "color": "#343535",
        "fitScore": 0.488,
        "sampleBox": {
          "x": 0.7064814814814815,
          "y": 0.8937037037037037,
          "width": 0.15555555555555556,
          "height": 0.015925925925925927
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/elsie-swash-caps-900.woff2"
      },
      "subheadline": {
        "fontId": "overlock",
        "family": "Overlock",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.55,
        "lineHeight": 1.2,
        "tracking": 0.01,
        "align": "left",
        "color": "#3b3b3b",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.3,
          "width": 0.8,
          "height": 0.04
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/overlock-900.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-market-report-feed-164",
    "name": "Suburb Market Report \u2014 Feed 164",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Local homeowners seeking current suburb price and demand insights",
    "category": "market-report-lead-generation",
    "tags": [
      "market-report",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-market-report-feed-164-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_164.png",
    "sourceHash": "152a128aafd4d60567da3794f14cb02dbd7105f6913c73317f70ec8b786c655b",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 43,
        "sample": "YOUR SUBURB MARKET UPDATE",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 46,
        "sample": "LOCAL PRICES. CLEAR INSIGHT.",
        "required": true
      },
      {
        "key": "stat_1",
        "label": "Stat 1",
        "maxLength": 38,
        "sample": "CURRENT MEDIAN PRICE",
        "required": true
      },
      {
        "key": "stat_2",
        "label": "Stat 2",
        "maxLength": 30,
        "sample": "RECENT SALES",
        "required": true
      },
      {
        "key": "stat_3",
        "label": "Stat 3",
        "maxLength": 32,
        "sample": "DAYS ON MARKET",
        "required": true
      },
      {
        "key": "stat_4",
        "label": "Stat 4",
        "maxLength": 30,
        "sample": "BUYER DEMAND",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "chart_graphic",
        "label": "Market chart",
        "required": true,
        "box": {
          "x": 0.012962962962962963,
          "y": 0.2859259259259259,
          "width": 0.9740740740740741,
          "height": 0.4666666666666667
        }
      }
    ],
    "typography": {
      "subheadline": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "sizeRatio": 1.3125,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#3c6062",
        "fitScore": 0.39,
        "sampleBox": {
          "x": 0.22268518518518518,
          "y": 0.23,
          "width": 0.41712962962962963,
          "height": 0.016296296296296295
        },
        "sampleLineCount": 1,
        "detectionScore": 0.692,
        "fontFile": "/fonts/adstudio/merriweather-900.woff2"
      },
      "stat_1": {
        "fontId": "big-shoulders",
        "family": "Big Shoulders",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "sizeRatio": 0.6043526785714285,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#515151",
        "fitScore": 0.491,
        "sampleBox": {
          "x": 0.06018518518518518,
          "y": 0.8962962962962963,
          "width": 0.17916666666666667,
          "height": 0.04296296296296296
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/big-shoulders-800.woff2"
      },
      "stat_3": {
        "fontId": "grenze-gotisch",
        "family": "Grenze Gotisch",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "sizeRatio": 0.9586956521739131,
        "lineHeight": 1.48,
        "tracking": 0,
        "align": "left",
        "color": "#4e4d4e",
        "fitScore": 0.291,
        "sampleBox": {
          "x": 0.5467592592592593,
          "y": 0.8962962962962963,
          "width": 0.11157407407407408,
          "height": 0.016296296296296295
        },
        "sampleLineCount": 1,
        "detectionScore": 0.5,
        "fontFile": "/fonts/adstudio/grenze-gotisch-900.woff2"
      },
      "stat_2": {
        "fontId": "big-shoulders",
        "family": "Big Shoulders",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "sizeRatio": 1.2352941176470589,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#525253",
        "fitScore": 0.262,
        "sampleBox": {
          "x": 0.3277777777777778,
          "y": 0.8962962962962963,
          "width": 0.10231481481481482,
          "height": 0.016296296296296295
        },
        "sampleLineCount": 1,
        "detectionScore": 0.5,
        "fontFile": "/fonts/adstudio/big-shoulders-900.woff2"
      },
      "stat_4": {
        "fontId": "big-shoulders",
        "family": "Big Shoulders",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "sizeRatio": 1.2352941176470589,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#424243",
        "fitScore": 0.219,
        "sampleBox": {
          "x": 0.7833333333333333,
          "y": 0.9248148148148149,
          "width": 0.10833333333333334,
          "height": 0.015925925925925927
        },
        "sampleLineCount": 1,
        "detectionScore": 0.5,
        "fontFile": "/fonts/adstudio/big-shoulders-900.woff2"
      },
      "headline": {
        "fontId": "big-shoulders",
        "family": "Big Shoulders",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.7,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#3c6062",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.15,
          "width": 0.8,
          "height": 0.1
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/big-shoulders-300.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-market-report-feed-167",
    "name": "Suburb Market Report \u2014 Feed 167",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Local homeowners seeking current suburb price and demand insights",
    "category": "market-report-lead-generation",
    "tags": [
      "market-report",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-market-report-feed-167-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_167.png",
    "sourceHash": "9551c77edfd63e065f5f6bdc00d574e2864a765e1447c33b8be4bc6cf5651fa8",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 43,
        "sample": "YOUR SUBURB MARKET UPDATE",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 46,
        "sample": "LOCAL PRICES. CLEAR INSIGHT.",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 96,
        "sample": "Get the latest local sales, price trends and buyer demand in one clear report.",
        "required": true
      },
      {
        "key": "stat_1",
        "label": "Stat 1",
        "maxLength": 38,
        "sample": "CURRENT MEDIAN PRICE",
        "required": true
      },
      {
        "key": "stat_2",
        "label": "Stat 2",
        "maxLength": 30,
        "sample": "RECENT SALES",
        "required": true
      },
      {
        "key": "stat_3",
        "label": "Stat 3",
        "maxLength": 32,
        "sample": "DAYS ON MARKET",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 37,
        "sample": "GET THE FREE REPORT",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true,
        "box": {
          "x": 0,
          "y": 0,
          "width": 1,
          "height": 1
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.787962962962963,
          "y": 0,
          "width": 0.14814814814814814,
          "height": 0.13333333333333333
        }
      }
    ],
    "typography": {
      "body": {
        "fontId": "roboto",
        "family": "Roboto",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "mixed",
        "measurementVersion": 2,
        "measurementSource": "ocr-v2",
        "sizeRatio": 0.53173828125,
        "lineHeight": 1.171875,
        "tracking": 0,
        "align": "center",
        "color": "#d7e6e8",
        "fitScore": 0.646,
        "sampleBox": {
          "x": 0.2324074074074074,
          "y": 0.3074074074074074,
          "width": 0.5634259259259259,
          "height": 0.05333333333333334
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "measuredLines": [
          {
            "text": "Get the latest local sales, price trends",
            "sampleBox": {
              "x": 0.23333333333333334,
              "y": 0.3074074074074074,
              "width": 0.5615740740740741,
              "height": 0.024444444444444446
            },
            "sizeRatio": 1.16015625
          },
          {
            "text": "and buyer demand in one clear report.",
            "sampleBox": {
              "x": 0.2324074074074074,
              "y": 0.3362962962962963,
              "width": 0.5634259259259259,
              "height": 0.024444444444444446
            },
            "sizeRatio": 1.16015625
          }
        ],
        "fontFile": "/fonts/adstudio/roboto-600.woff2"
      },
      "subheadline": {
        "fontId": "frank-ruhl-libre",
        "family": "Frank Ruhl Libre",
        "fallbackFamily": "serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "measurementSource": "ocr-v2",
        "sizeRatio": 1.382488479262673,
        "lineHeight": 1.291,
        "tracking": 0,
        "align": "center",
        "color": "#e4bf6f",
        "fitScore": 0.624,
        "sampleBox": {
          "x": 0.19027777777777777,
          "y": 0.2637037037037037,
          "width": 0.6546296296296297,
          "height": 0.022222222222222223
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "measuredLines": [
          {
            "text": "LOCAL PRICES. CLEAR INSIGHT.",
            "sampleBox": {
              "x": 0.19027777777777777,
              "y": 0.2637037037037037,
              "width": 0.6546296296296297,
              "height": 0.022222222222222223
            },
            "sizeRatio": 1.382488479262673
          }
        ],
        "fontFile": "/fonts/adstudio/frank-ruhl-libre-900.woff2"
      },
      "headline": {
        "fontId": "poppins",
        "family": "Poppins",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "measurementSource": "ocr-v2",
        "sizeRatio": 0.6752232142857142,
        "lineHeight": 1.5,
        "tracking": 0,
        "align": "center",
        "color": "#f5f7f8",
        "fitScore": 0.499,
        "sampleBox": {
          "x": 0.1537037037037037,
          "y": 0.12296296296296297,
          "width": 0.7416666666666667,
          "height": 0.11333333333333333
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "measuredLines": [
          {
            "text": "YOUR SUBURB",
            "sampleBox": {
              "x": 0.17314814814814813,
              "y": 0.12296296296296297,
              "width": 0.6592592592592592,
              "height": 0.05185185185185185
            },
            "sizeRatio": 1.4758450255102038
          },
          {
            "text": "MARKET UPDATE",
            "sampleBox": {
              "x": 0.1537037037037037,
              "y": 0.1862962962962963,
              "width": 0.7416666666666667,
              "height": 0.05
            },
            "sizeRatio": 1.530505952380952
          }
        ],
        "fontFile": "/fonts/adstudio/poppins-900.woff2"
      },
      "stat_1": {
        "fontId": "outfit",
        "family": "Outfit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "measurementSource": "ocr-v2",
        "sizeRatio": 0.6776470588235294,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "left",
        "color": "#d2d7d9",
        "fitScore": 0.702,
        "sampleBox": {
          "x": 0.11296296296296296,
          "y": 0.8218518518518518,
          "width": 0.21203703703703702,
          "height": 0.043333333333333335
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "measuredLines": [
          {
            "text": "CURRENT",
            "sampleBox": {
              "x": 0.14629629629629629,
              "y": 0.8218518518518518,
              "width": 0.14212962962962963,
              "height": 0.017407407407407406
            },
            "sizeRatio": 1.6869086357947434
          },
          {
            "text": "MEDIAN PRICE",
            "sampleBox": {
              "x": 0.11296296296296296,
              "y": 0.847037037037037,
              "width": 0.21203703703703702,
              "height": 0.01814814814814815
            },
            "sizeRatio": 1.6180552220888353
          }
        ],
        "fontFile": "/fonts/adstudio/outfit-900.woff2"
      },
      "cta": {
        "fontId": "figtree",
        "family": "Figtree",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "measurementSource": "ocr-v2",
        "sizeRatio": 1.3484311740890689,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#1a2d33",
        "fitScore": 0.843,
        "sampleBox": {
          "x": 0.26064814814814813,
          "y": 0.9255555555555556,
          "width": 0.5078703703703704,
          "height": 0.027037037037037037
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "measuredLines": [
          {
            "text": "GET THE FREE REPORT",
            "sampleBox": {
              "x": 0.26064814814814813,
              "y": 0.9255555555555556,
              "width": 0.5078703703703704,
              "height": 0.027037037037037037
            },
            "sizeRatio": 1.3484311740890689
          }
        ],
        "fontFile": "/fonts/adstudio/figtree-900.woff2"
      },
      "stat_3": {
        "fontId": "londrina-solid",
        "family": "Londrina Solid",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "measurementSource": "ocr-v2",
        "sizeRatio": 1.2783564814814816,
        "lineHeight": 1.183,
        "tracking": 0,
        "align": "left",
        "color": "#e1e4e6",
        "fitScore": 0.248,
        "sampleBox": {
          "x": 0.7078703703703704,
          "y": 0.8222222222222222,
          "width": 0.1300925925925926,
          "height": 0.017407407407407406
        },
        "sampleLineCount": 1,
        "detectionScore": 0.5,
        "measuredLines": [
          {
            "text": "DAYS ON",
            "sampleBox": {
              "x": 0.7078703703703704,
              "y": 0.8222222222222222,
              "width": 0.1300925925925926,
              "height": 0.017407407407407406
            },
            "sizeRatio": 1.2783564814814816
          }
        ],
        "fontFile": "/fonts/adstudio/londrina-solid-900.woff2"
      },
      "stat_2": {
        "fontId": "londrina-solid",
        "family": "Londrina Solid",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "measurementVersion": 2,
        "measurementSource": "ocr-v2",
        "sizeRatio": 1.2783564814814816,
        "lineHeight": 1.183,
        "tracking": 0,
        "align": "center",
        "color": "#dadddf",
        "fitScore": 0.319,
        "sampleBox": {
          "x": 0.4398148148148148,
          "y": 0.8222222222222222,
          "width": 0.11898148148148148,
          "height": 0.017407407407407406
        },
        "sampleLineCount": 1,
        "detectionScore": 0.5,
        "measuredLines": [
          {
            "text": "RECENT",
            "sampleBox": {
              "x": 0.4398148148148148,
              "y": 0.8222222222222222,
              "width": 0.11898148148148148,
              "height": 0.017407407407407406
            },
            "sizeRatio": 1.2783564814814816
          }
        ],
        "fontFile": "/fonts/adstudio/londrina-solid-900.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-market-report-story-239",
    "name": "Suburb Market Report \u2014 Story 239",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Local homeowners seeking current suburb price and demand insights",
    "category": "market-report-lead-generation",
    "tags": [
      "market-report",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-market-report-story-239-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_239.png",
    "sourceHash": "e6e021c986a14db8db5bc5150cd789aac6d86187f419969e76e0e511e5406e85",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 43,
        "sample": "YOUR SUBURB MARKET UPDATE",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 46,
        "sample": "LOCAL PRICES. CLEAR INSIGHT.",
        "required": true
      },
      {
        "key": "stat_1",
        "label": "Stat 1",
        "maxLength": 38,
        "sample": "CURRENT MEDIAN PRICE",
        "required": true
      },
      {
        "key": "stat_2",
        "label": "Stat 2",
        "maxLength": 30,
        "sample": "RECENT SALES",
        "required": true
      },
      {
        "key": "stat_3",
        "label": "Stat 3",
        "maxLength": 32,
        "sample": "DAYS ON MARKET",
        "required": true
      },
      {
        "key": "stat_4",
        "label": "Stat 4",
        "maxLength": 30,
        "sample": "BUYER DEMAND",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 37,
        "sample": "GET THE FREE REPORT",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "background_photo",
        "label": "Background photo",
        "required": true,
        "box": {
          "x": 0.018518518518518517,
          "y": 0.010416666666666666,
          "width": 0.9629629629629629,
          "height": 0.9791666666666666
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.7148148148148148,
          "y": 0.834375,
          "width": 0.2222222222222222,
          "height": 0.12708333333333333
        }
      }
    ],
    "typography": {
      "subheadline": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3493253373313343,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "left",
        "color": "#cccac8",
        "fitScore": 0.415,
        "sampleBox": {
          "x": 0.09814814814814815,
          "y": 0.4830729166666667,
          "width": 0.5300925925925926,
          "height": 0.013802083333333333
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-800.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238095256814852,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#6a6141",
        "fitScore": 0.357,
        "sampleBox": {
          "x": 0.08935185185185185,
          "y": 0.3802083333333333,
          "width": 0.7291666666666666,
          "height": 0.10442708333333334
        },
        "sampleLineCount": 7,
        "detectionScore": 0.667,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "stat_1": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.1948051948051948,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "left",
        "color": "#877450",
        "fitScore": 0.636,
        "sampleBox": {
          "x": 0.11296296296296296,
          "y": 0.53515625,
          "width": 0.5361111111111111,
          "height": 0.04192708333333333
        },
        "sampleLineCount": 1,
        "detectionScore": 0.909,
        "fontFile": "/fonts/adstudio/oswald-300.woff2"
      },
      "stat_3": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2033333333333336,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "left",
        "color": "#af9563",
        "fitScore": 0.697,
        "sampleBox": {
          "x": 0.12037037037037036,
          "y": 0.6786458333333333,
          "width": 0.4361111111111111,
          "height": 0.034375
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-300.woff2"
      },
      "stat_2": {
        "fontId": "lora",
        "family": "Lora",
        "fallbackFamily": "serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.36,
        "lineHeight": 1.28,
        "tracking": 0,
        "align": "left",
        "color": "#d5b372",
        "fitScore": 0.946,
        "sampleBox": {
          "x": 0.12083333333333333,
          "y": 0.6098958333333333,
          "width": 0.37083333333333335,
          "height": 0.03125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/lora-600.woff2"
      },
      "stat_4": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3349206349206348,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "left",
        "color": "#c4a56a",
        "fitScore": 0.436,
        "sampleBox": {
          "x": 0.23703703703703705,
          "y": 0.7604166666666666,
          "width": 0.2833333333333333,
          "height": 0.01328125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-700.woff2"
      },
      "cta": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.65,
        "lineHeight": 1.2,
        "tracking": 0.02,
        "align": "center",
        "color": "#cccac8",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.78,
          "width": 0.8,
          "height": 0.05
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/oswald-300.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-market-report-story-242",
    "name": "Suburb Market Report \u2014 Story 242",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Local homeowners seeking current suburb price and demand insights",
    "category": "market-report-lead-generation",
    "tags": [
      "market-report",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-market-report-story-242-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_242.png",
    "sourceHash": "0eee2af2e649a1fc4f2c543cce4de3ac75baef44a6309f54e07280bd833066eb",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 43,
        "sample": "YOUR SUBURB MARKET UPDATE",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 46,
        "sample": "LOCAL PRICES. CLEAR INSIGHT.",
        "required": true
      },
      {
        "key": "stat_1",
        "label": "Stat 1",
        "maxLength": 38,
        "sample": "CURRENT MEDIAN PRICE",
        "required": true
      },
      {
        "key": "stat_2",
        "label": "Stat 2",
        "maxLength": 30,
        "sample": "RECENT SALES",
        "required": true
      },
      {
        "key": "stat_3",
        "label": "Stat 3",
        "maxLength": 32,
        "sample": "DAYS ON MARKET",
        "required": true
      },
      {
        "key": "stat_4",
        "label": "Stat 4",
        "maxLength": 30,
        "sample": "BUYER DEMAND",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 37,
        "sample": "GET THE FREE REPORT",
        "required": true
      },
      {
        "key": "website",
        "label": "Website",
        "maxLength": 35,
        "sample": "youragency.com.au",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true,
        "box": {
          "x": 0.5879629629629629,
          "y": 0,
          "width": 0.41203703703703703,
          "height": 1
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.22962962962962963,
          "y": 0.1015625,
          "width": 0.13333333333333333,
          "height": 0.07291666666666667
        }
      }
    ],
    "typography": {
      "subheadline": {
        "fontId": "barlow-condensed",
        "family": "Barlow Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3703007518796992,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#68635e",
        "fitScore": 0.926,
        "sampleBox": {
          "x": 0.06759259259259259,
          "y": 0.42161458333333335,
          "width": 0.8425925925925926,
          "height": 0.025
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/barlow-condensed-900.woff2"
      },
      "headline": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 500,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2800000273291752,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "center",
        "color": "#4f5757",
        "fitScore": 0.237,
        "sampleBox": {
          "x": 0.055092592592592596,
          "y": 0.22161458333333334,
          "width": 0.9185185185185185,
          "height": 0.18125
        },
        "sampleLineCount": 7,
        "detectionScore": 0.75,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-500.woff2"
      },
      "stat_1": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.4576819407008088,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#303b34",
        "fitScore": 0.334,
        "sampleBox": {
          "x": 0.07777777777777778,
          "y": 0.5838541666666667,
          "width": 0.9157407407407407,
          "height": 0.023958333333333335
        },
        "sampleLineCount": 4,
        "detectionScore": 0.65,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      },
      "cta": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5263157894736843,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#6e633d",
        "fitScore": 0.161,
        "sampleBox": {
          "x": 0.10416666666666667,
          "y": 0.8536458333333333,
          "width": 0.7310185185185185,
          "height": 0.013020833333333334
        },
        "sampleLineCount": 2,
        "detectionScore": 0.684,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      },
      "website": {
        "fontId": "lora",
        "family": "Lora",
        "fallbackFamily": "serif",
        "weight": 600,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.139043381535039,
        "lineHeight": 1.28,
        "tracking": 0,
        "align": "left",
        "color": "#bfc4c9",
        "fitScore": 0.654,
        "sampleBox": {
          "x": 0.11851851851851852,
          "y": 0.9106770833333333,
          "width": 0.3527777777777778,
          "height": 0.014583333333333334
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/lora-600.woff2"
      },
      "stat_3": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3354700854700854,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#4e4e2e",
        "fitScore": 0.356,
        "sampleBox": {
          "x": 0.11435185185185186,
          "y": 0.7354166666666667,
          "width": 0.8740740740740741,
          "height": 0.011197916666666667
        },
        "sampleLineCount": 3,
        "detectionScore": 0.643,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "stat_2": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3529411764705883,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#cfab6a",
        "fitScore": 0.428,
        "sampleBox": {
          "x": 0.3712962962962963,
          "y": 0.5783854166666667,
          "width": 0.1,
          "height": 0.01015625
        },
        "sampleLineCount": 1,
        "detectionScore": 0.5,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "stat_4": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3827160493827158,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#9d874e",
        "fitScore": 0.689,
        "sampleBox": {
          "x": 0.3638888888888889,
          "y": 0.7533854166666667,
          "width": 0.34305555555555556,
          "height": 0.012760416666666666
        },
        "sampleLineCount": 2,
        "detectionScore": 0.667,
        "fontFile": "/fonts/adstudio/merriweather-700.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-offmarket-alerts-feed-130",
    "name": "Off-Market Property Alerts \u2014 Feed 130",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Buyers wanting early access to local off-market opportunities",
    "category": "buyer-registration-lead-generation",
    "tags": [
      "offmarket-alerts",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-offmarket-alerts-feed-130-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_130.png",
    "sourceHash": "e67fa125ceae87e45080bb42f65f84e59d22c62d913582fe201fffdb7c9155b9",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 54,
        "sample": "SEE HOMES BEFORE THEY HIT THE MARKET",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 86,
        "sample": "Register your preferences and hear about suitable local homes first.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 37,
        "sample": "REGISTER FOR ALERTS",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true,
        "box": {
          "x": 0.1111111111,
          "y": 0.2777777778,
          "width": 0.337962963,
          "height": 0.542962963
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.7814814815,
          "y": 0.84,
          "width": 0.1740740741,
          "height": 0.137037037
        }
      }
    ],
    "typography": {
      "body": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0963855421686748,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#a29b85",
        "fitScore": 0.23,
        "sampleBox": {
          "x": 0.24675925925925926,
          "y": 0.5625925925925926,
          "width": 0.5814814814814815,
          "height": 0.11703703703703704
        },
        "sampleLineCount": 6,
        "detectionScore": 0.905,
        "fontFile": "/fonts/adstudio/kanit-600.woff2"
      },
      "headline": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 500,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2800000895426007,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "center",
        "color": "#b4ad9f",
        "fitScore": 0.302,
        "sampleBox": {
          "x": 0.1050925925925926,
          "y": 0.2859259259259259,
          "width": 0.8231481481481482,
          "height": 0.21333333333333335
        },
        "sampleLineCount": 8,
        "detectionScore": 0.818,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-500.woff2"
      },
      "cta": {
        "fontId": "barlow",
        "family": "Barlow",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3894376248929488,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#736f55",
        "fitScore": 0.233,
        "sampleBox": {
          "x": 0.13425925925925927,
          "y": 0.67,
          "width": 0.7842592592592592,
          "height": 0.10111111111111111
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/barlow-600.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-offmarket-alerts-feed-177",
    "name": "Off-Market Property Alerts \u2014 Feed 177",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Buyers wanting early access to local off-market opportunities",
    "category": "buyer-registration-lead-generation",
    "tags": [
      "offmarket-alerts",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-offmarket-alerts-feed-177-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_177.png",
    "sourceHash": "d0ecbb97ff564edce99b987ac8665e231f7227b627ca32349378282b5543351a",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 54,
        "sample": "SEE HOMES BEFORE THEY HIT THE MARKET",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 44,
        "sample": "JOIN OUR OFF-MARKET ALERTS",
        "required": true
      },
      {
        "key": "benefit_1",
        "label": "Benefit 1",
        "maxLength": 30,
        "sample": "EARLY ACCESS",
        "required": true
      },
      {
        "key": "benefit_2",
        "label": "Benefit 2",
        "maxLength": 31,
        "sample": "MATCHED HOMES",
        "required": true
      },
      {
        "key": "benefit_3",
        "label": "Benefit 3",
        "maxLength": 31,
        "sample": "LOCAL UPDATES",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 37,
        "sample": "REGISTER FOR ALERTS",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 30,
        "sample": "0400 123 456",
        "required": true
      },
      {
        "key": "website",
        "label": "Website",
        "maxLength": 35,
        "sample": "youragency.com.au",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true,
        "box": {
          "x": 0,
          "y": 0,
          "width": 1,
          "height": 0.725925925925926
        }
      },
      {
        "key": "location_graphic",
        "label": "Location visual",
        "required": true,
        "box": {
          "x": 0,
          "y": 0.725925925925926,
          "width": 1,
          "height": 0.16592592592592592
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.8027777777777778,
          "y": 0.8955555555555555,
          "width": 0.13425925925925927,
          "height": 0.10444444444444445
        }
      }
    ],
    "typography": {
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238094822652395,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#ebe5d6",
        "fitScore": 0.484,
        "sampleBox": {
          "x": 0.08009259259259259,
          "y": 0.05296296296296296,
          "width": 0.861574074074074,
          "height": 0.11148148148148149
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "fira-sans",
        "family": "Fira Sans",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.0666666666666667,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#eccb92",
        "fitScore": 0.506,
        "sampleBox": {
          "x": 0.19490740740740742,
          "y": 0.19148148148148147,
          "width": 0.6148148148148148,
          "height": 0.02074074074074074
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/fira-sans-900.woff2"
      },
      "cta": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.509315375982043,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#82794a",
        "fitScore": 0.195,
        "sampleBox": {
          "x": 0.040740740740740744,
          "y": 0.9203703703703704,
          "width": 0.8722222222222222,
          "height": 0.053703703703703705
        },
        "sampleLineCount": 8,
        "detectionScore": 0.391,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      },
      "website": {
        "fontId": "open-sans",
        "family": "Open Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.2556679455877224,
        "lineHeight": 1.36181640625,
        "tracking": 0,
        "align": "left",
        "color": "#c2bb97",
        "fitScore": 0.644,
        "sampleBox": {
          "x": 0.5083333333333333,
          "y": 0.9511111111111111,
          "width": 0.26157407407407407,
          "height": 0.03888888888888889
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/open-sans-300.woff2"
      },
      "benefit_2": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3888888888888888,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#3e2596",
        "fitScore": 0.464,
        "sampleBox": {
          "x": 0.4083333333333333,
          "y": 0.3411111111111111,
          "width": 0.18194444444444444,
          "height": 0.012222222222222223
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-900.woff2"
      },
      "benefit_3": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3888888888888888,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#3e2495",
        "fitScore": 0.437,
        "sampleBox": {
          "x": 0.7027777777777777,
          "y": 0.3411111111111111,
          "width": 0.16620370370370371,
          "height": 0.012222222222222223
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-900.woff2"
      },
      "benefit_1": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3888888888888888,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#3f2696",
        "fitScore": 0.442,
        "sampleBox": {
          "x": 0.12638888888888888,
          "y": 0.3411111111111111,
          "width": 0.14907407407407408,
          "height": 0.012222222222222223
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-900.woff2"
      },
      "phone": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.2678260869565219,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#d7d8c7",
        "fitScore": 0.435,
        "sampleBox": {
          "x": 0.5699074074074074,
          "y": 0.9185185185185185,
          "width": 0.1587962962962963,
          "height": 0.017037037037037038
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-offmarket-alerts-feed-195",
    "name": "Off-Market Property Alerts \u2014 Feed 195",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Buyers wanting early access to local off-market opportunities",
    "category": "buyer-registration-lead-generation",
    "tags": [
      "offmarket-alerts",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-offmarket-alerts-feed-195-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_195.png",
    "sourceHash": "4e4abdd1d821249a17f3e91352e6f3d3d726826657682ee0433ba10a765e6614",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 54,
        "sample": "SEE HOMES BEFORE THEY HIT THE MARKET",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 44,
        "sample": "JOIN OUR OFF-MARKET ALERTS",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 86,
        "sample": "Register your preferences and hear about suitable local homes first.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 37,
        "sample": "REGISTER FOR ALERTS",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 0.9890109890109892,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "right",
        "color": "#9da49f",
        "fitScore": 0.722,
        "sampleBox": {
          "x": 0.2740740740740741,
          "y": 0.38074074074074077,
          "width": 0.725925925925926,
          "height": 0.057777777777777775
        },
        "sampleLineCount": 6,
        "detectionScore": 0.868,
        "fontFile": "/fonts/adstudio/oswald-400.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.523809534226553,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#ebf1f7",
        "fitScore": 0.568,
        "sampleBox": {
          "x": 0.08935185185185185,
          "y": 0.16666666666666666,
          "width": 0.8356481481481481,
          "height": 0.11962962962962963
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.4594594594594594,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#dab873",
        "fitScore": 0.508,
        "sampleBox": {
          "x": 0.18611111111111112,
          "y": 0.32296296296296295,
          "width": 0.6564814814814814,
          "height": 0.024074074074074074
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-700.woff2"
      },
      "cta": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238094556180406,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#54492a",
        "fitScore": 0.294,
        "sampleBox": {
          "x": 0.3162037037037037,
          "y": 0.7418518518518519,
          "width": 0.5671296296296297,
          "height": 0.13296296296296295
        },
        "sampleLineCount": 5,
        "detectionScore": 0.368,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-offmarket-alerts-story-043",
    "name": "Off-Market Property Alerts \u2014 Story 043",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Buyers wanting early access to local off-market opportunities",
    "category": "buyer-registration-lead-generation",
    "tags": [
      "offmarket-alerts",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-offmarket-alerts-story-043-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_043.png",
    "sourceHash": "1d264a515215d94a8a47386b36922b672cfe7cac055a0bd362ccc11865afe962",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 54,
        "sample": "SEE HOMES BEFORE THEY HIT THE MARKET",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 44,
        "sample": "JOIN OUR OFF-MARKET ALERTS",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 86,
        "sample": "Register your preferences and hear about suitable local homes first.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 37,
        "sample": "REGISTER FOR ALERTS",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo_1",
        "label": "Property photo 1",
        "required": true
      },
      {
        "key": "property_photo_2",
        "label": "Property photo 2",
        "required": true
      },
      {
        "key": "property_photo_3",
        "label": "Property photo 3",
        "required": true
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0277777777777777,
        "lineHeight": 1.424,
        "tracking": 0,
        "align": "left",
        "color": "#5b5b5c",
        "fitScore": 0.616,
        "sampleBox": {
          "x": 0.06759259259259259,
          "y": 0.34296875,
          "width": 0.4703703703703704,
          "height": 0.03333333333333333
        },
        "sampleLineCount": 2,
        "detectionScore": 1
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238095149843132,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#464747",
        "fitScore": 0.585,
        "sampleBox": {
          "x": 0.06620370370370371,
          "y": 0.058854166666666666,
          "width": 0.7587962962962963,
          "height": 0.22213541666666667
        },
        "sampleLineCount": 5,
        "detectionScore": 0.972,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "fira-sans",
        "family": "Fira Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.0666666666666667,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#848f97",
        "fitScore": 0.55,
        "sampleBox": {
          "x": 0.06620370370370371,
          "y": 0.3033854166666667,
          "width": 0.6305555555555555,
          "height": 0.01484375
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/fira-sans-800.woff2"
      },
      "cta": {
        "fontId": "lora",
        "family": "Lora",
        "fallbackFamily": "serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.374025974025974,
        "lineHeight": 1.28,
        "tracking": 0,
        "align": "left",
        "color": "#abac93",
        "fitScore": 0.248,
        "sampleBox": {
          "x": 0.20925925925925926,
          "y": 0.82578125,
          "width": 0.0912037037037037,
          "height": 0.020833333333333332
        },
        "sampleLineCount": 3,
        "detectionScore": 0.368,
        "fontFile": "/fonts/adstudio/lora-600.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-offmarket-alerts-story-260",
    "name": "Off-Market Property Alerts \u2014 Story 260",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Buyers wanting early access to local off-market opportunities",
    "category": "buyer-registration-lead-generation",
    "tags": [
      "offmarket-alerts",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-offmarket-alerts-story-260-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_260.png",
    "sourceHash": "0f66fdfa9a3efa10b3f74b9f8a60422ef1dc6d0bf97c15447d10c7f2f80c8e8e",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 54,
        "sample": "SEE HOMES BEFORE THEY HIT THE MARKET",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 44,
        "sample": "JOIN OUR OFF-MARKET ALERTS",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 86,
        "sample": "Register your preferences and hear about suitable local homes first.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 37,
        "sample": "REGISTER FOR ALERTS",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "hero_graphic",
        "label": "Hero property image",
        "required": true,
        "box": {
          "x": 0,
          "y": 0.690625,
          "width": 1,
          "height": 0.309375
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.4444444444444444,
          "y": 0.044270833333333336,
          "width": 0.1111111111111111,
          "height": 0.059895833333333336
        }
      }
    ],
    "typography": {
      "body": {
        "fontId": "raleway",
        "family": "Raleway",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0133244503664223,
        "lineHeight": 1.174,
        "tracking": 0,
        "align": "center",
        "color": "#cacad2",
        "fitScore": 0.604,
        "sampleBox": {
          "x": 0.2513888888888889,
          "y": 0.34140625,
          "width": 0.5370370370370371,
          "height": 0.03567708333333333
        },
        "sampleLineCount": 9,
        "detectionScore": 0.788,
        "fontFile": "/fonts/adstudio/raleway-300.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5465116279069768,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#e7e7ea",
        "fitScore": 0.662,
        "sampleBox": {
          "x": 0.2175925925925926,
          "y": 0.16953125,
          "width": 0.5967592592592592,
          "height": 0.06015625
        },
        "sampleLineCount": 5,
        "detectionScore": 0.472,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "noto-serif",
        "family": "Noto Serif",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.0676470588235294,
        "lineHeight": 1.362,
        "tracking": 0,
        "align": "center",
        "color": "#dab979",
        "fitScore": 0.511,
        "sampleBox": {
          "x": 0.21064814814814814,
          "y": 0.3059895833333333,
          "width": 0.6138888888888889,
          "height": 0.015104166666666667
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/noto-serif-800.woff2"
      },
      "cta": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.4840425531914896,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "left",
        "color": "#a88d4e",
        "fitScore": 0.232,
        "sampleBox": {
          "x": 0.11388888888888889,
          "y": 0.9453125,
          "width": 0.43287037037037035,
          "height": 0.0421875
        },
        "sampleLineCount": 4,
        "detectionScore": 0.421,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-rental-appraisal-feed-135",
    "name": "Rental Appraisal \u2014 Feed 135",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Property investors and landlords seeking current rental guidance",
    "category": "investor-lead-generation",
    "tags": [
      "rental-appraisal",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-rental-appraisal-feed-135-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_135.png",
    "sourceHash": "3887515659e605eb00b0a80140629a2e6d8e2f60502276b820d9254ad85cd6ee",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 52,
        "sample": "WHAT COULD YOUR PROPERTY RENT FOR?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 44,
        "sample": "REQUEST A RENTAL APPRAISAL",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 86,
        "sample": "Get a clear view of current rent, tenant demand and your next steps.",
        "required": true
      },
      {
        "key": "benefit_1",
        "label": "Benefit 1",
        "maxLength": 30,
        "sample": "CURRENT RENT",
        "required": true
      },
      {
        "key": "benefit_2",
        "label": "Benefit 2",
        "maxLength": 31,
        "sample": "TENANT DEMAND",
        "required": true
      },
      {
        "key": "benefit_3",
        "label": "Benefit 3",
        "maxLength": 35,
        "sample": "INVESTOR GUIDANCE",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 41,
        "sample": "BOOK A RENTAL APPRAISAL",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo_1",
        "label": "Property photo 1",
        "required": true,
        "box": {
          "x": 0.49444444444444446,
          "y": 0.040740740740740744,
          "width": 0.5055555555555555,
          "height": 0.45185185185185184
        }
      },
      {
        "key": "property_photo_2",
        "label": "Property photo 2",
        "required": true,
        "box": {
          "x": 0.49444444444444446,
          "y": 0.5037037037037037,
          "width": 0.5055555555555555,
          "height": 0.43333333333333335
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.040740740740740744,
          "y": 0.047407407407407405,
          "width": 0.11481481481481481,
          "height": 0.09259259259259259
        }
      }
    ],
    "typography": {
      "body": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0317460317460319,
        "lineHeight": 1.424,
        "tracking": 0,
        "align": "left",
        "color": "#565a5f",
        "fitScore": 0.587,
        "sampleBox": {
          "x": 0.044444444444444446,
          "y": 0.562962962962963,
          "width": 0.37546296296296294,
          "height": 0.04296296296296296
        },
        "sampleLineCount": 3,
        "detectionScore": 0.88
      },
      "headline": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3061224104156475,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "center",
        "color": "#a6a092",
        "fitScore": 0.231,
        "sampleBox": {
          "x": 0.041666666666666664,
          "y": 0.2,
          "width": 0.42685185185185187,
          "height": 0.1874074074074074
        },
        "sampleLineCount": 3,
        "detectionScore": 0.727,
        "fontFile": "/fonts/adstudio/manrope-600.woff2"
      },
      "subheadline": {
        "fontId": "nunito-sans",
        "family": "Nunito Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.0727040816326532,
        "lineHeight": 1.364,
        "tracking": 0,
        "align": "left",
        "color": "#daac60",
        "fitScore": 0.56,
        "sampleBox": {
          "x": 0.044444444444444446,
          "y": 0.4874074074074074,
          "width": 0.42083333333333334,
          "height": 0.018518518518518517
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/nunito-sans-800.woff2"
      },
      "cta": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3230490018148817,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "left",
        "color": "#1f3239",
        "fitScore": 0.411,
        "sampleBox": {
          "x": 0.0763888888888889,
          "y": 0.8925925925925926,
          "width": 0.35185185185185186,
          "height": 0.017407407407407406
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-800.woff2"
      },
      "benefit_3": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3376190476190473,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "left",
        "color": "#394648",
        "fitScore": 0.984,
        "sampleBox": {
          "x": 0.04398148148148148,
          "y": 0.7766666666666666,
          "width": 0.3861111111111111,
          "height": 0.06296296296296296
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-600.woff2"
      },
      "benefit_2": {
        "fontId": "lora",
        "family": "Lora",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3663454410674574,
        "lineHeight": 1.28,
        "tracking": 0,
        "align": "left",
        "color": "#2a3c42",
        "fitScore": 0.729,
        "sampleBox": {
          "x": 0.14629629629629629,
          "y": 0.7277777777777777,
          "width": 0.23425925925925925,
          "height": 0.015925925925925927
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/lora-700.woff2"
      },
      "benefit_1": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2016010538582358,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "left",
        "color": "#314044",
        "fitScore": 0.834,
        "sampleBox": {
          "x": 0.14675925925925926,
          "y": 0.6548148148148148,
          "width": 0.20694444444444443,
          "height": 0.016296296296296295
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-300.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-rental-appraisal-feed-146",
    "name": "Rental Appraisal \u2014 Feed 146",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Property investors and landlords seeking current rental guidance",
    "category": "investor-lead-generation",
    "tags": [
      "rental-appraisal",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-rental-appraisal-feed-146-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_146.png",
    "sourceHash": "97e3301b3358d5b8bff7330b99502b73c8e201d361789deb2967f65dab0888fd",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 52,
        "sample": "WHAT COULD YOUR PROPERTY RENT FOR?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 44,
        "sample": "REQUEST A RENTAL APPRAISAL",
        "required": true
      },
      {
        "key": "benefit_1",
        "label": "Benefit 1",
        "maxLength": 30,
        "sample": "CURRENT RENT",
        "required": true
      },
      {
        "key": "benefit_2",
        "label": "Benefit 2",
        "maxLength": 31,
        "sample": "TENANT DEMAND",
        "required": true
      },
      {
        "key": "benefit_3",
        "label": "Benefit 3",
        "maxLength": 35,
        "sample": "INVESTOR GUIDANCE",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 41,
        "sample": "BOOK A RENTAL APPRAISAL",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo_1",
        "label": "Property photo 1",
        "required": true,
        "box": {
          "x": 0.044444444444444446,
          "y": 0.03777777777777778,
          "width": 0.45555555555555555,
          "height": 0.4540740740740741
        }
      },
      {
        "key": "property_photo_2",
        "label": "Property photo 2",
        "required": true,
        "box": {
          "x": 0.5092592592592593,
          "y": 0.03777777777777778,
          "width": 0.44814814814814813,
          "height": 0.23555555555555555
        }
      },
      {
        "key": "property_photo_3",
        "label": "Property photo 3",
        "required": true,
        "box": {
          "x": 0.5092592592592593,
          "y": 0.28,
          "width": 0.44814814814814813,
          "height": 0.21185185185185185
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.15185185185185185,
          "y": 0.8711111111111111,
          "width": 0.09722222222222222,
          "height": 0.07481481481481482
        }
      }
    ],
    "typography": {
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238095663933964,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#ecd5a3",
        "fitScore": 0.508,
        "sampleBox": {
          "x": 0.05092592592592592,
          "y": 0.5207407407407407,
          "width": 0.8986111111111111,
          "height": 0.11777777777777777
        },
        "sampleLineCount": 3,
        "detectionScore": 0.943,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.0221124946328897,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "center",
        "color": "#c5ad74",
        "fitScore": 0.667,
        "sampleBox": {
          "x": 0.05694444444444444,
          "y": 0.6674074074074074,
          "width": 0.5680555555555555,
          "height": 0.021111111111111112
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-300.woff2"
      },
      "cta": {
        "fontId": "quicksand",
        "family": "Quicksand",
        "fallbackFamily": "sans-serif",
        "weight": 500,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3767482517482514,
        "lineHeight": 1.25,
        "tracking": 0,
        "align": "center",
        "color": "#172f3a",
        "fitScore": 0.726,
        "sampleBox": {
          "x": 0.15231481481481482,
          "y": 0.8781481481481481,
          "width": 0.6907407407407408,
          "height": 0.06777777777777778
        },
        "sampleLineCount": 3,
        "detectionScore": 0.778,
        "fontFile": "/fonts/adstudio/quicksand-500.woff2"
      },
      "benefit_3": {
        "fontId": "lora",
        "family": "Lora",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3225,
        "lineHeight": 1.28,
        "tracking": 0,
        "align": "left",
        "color": "#c2c8cc",
        "fitScore": 0.428,
        "sampleBox": {
          "x": 0.6532407407407408,
          "y": 0.8096296296296296,
          "width": 0.22824074074074074,
          "height": 0.014074074074074074
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/lora-700.woff2"
      },
      "benefit_2": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.6206896551724137,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#a3abaf",
        "fitScore": 0.626,
        "sampleBox": {
          "x": 0.39166666666666666,
          "y": 0.8096296296296296,
          "width": 0.1912037037037037,
          "height": 0.014074074074074074
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-400.woff2"
      },
      "benefit_1": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3557422969187678,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#c7ccd1",
        "fitScore": 0.382,
        "sampleBox": {
          "x": 0.1300925925925926,
          "y": 0.81,
          "width": 0.16574074074074074,
          "height": 0.013333333333333334
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-rental-appraisal-story-234",
    "name": "Rental Appraisal \u2014 Story 234",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Property investors and landlords seeking current rental guidance",
    "category": "investor-lead-generation",
    "tags": [
      "rental-appraisal",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-rental-appraisal-story-234-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_234.png",
    "sourceHash": "f2be96eafb7a0a77341c9c73464b1161866f08bb968348474de50a0cac173ccd",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 52,
        "sample": "WHAT COULD YOUR PROPERTY RENT FOR?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 44,
        "sample": "REQUEST A RENTAL APPRAISAL",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 86,
        "sample": "Get a clear view of current rent, tenant demand and your next steps.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 41,
        "sample": "BOOK A RENTAL APPRAISAL",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "titillium-web",
        "family": "Titillium Web",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.1061946902654867,
        "lineHeight": 1.521,
        "tracking": 0,
        "align": "right",
        "color": "#8798a0",
        "fitScore": 0.244,
        "sampleBox": {
          "x": 0.1361111111111111,
          "y": 0.25026041666666665,
          "width": 0.8638888888888889,
          "height": 0.05703125
        },
        "sampleLineCount": 4,
        "detectionScore": 0.879,
        "fontFile": "/fonts/adstudio/titillium-web-900.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238096353959145,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#1c3c47",
        "fitScore": 0.449,
        "sampleBox": {
          "x": 0.13287037037037036,
          "y": 0.08958333333333333,
          "width": 0.6652777777777777,
          "height": 0.12604166666666666
        },
        "sampleLineCount": 3,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2692307692307692,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#22434e",
        "fitScore": 0.433,
        "sampleBox": {
          "x": 0.13657407407407407,
          "y": 0.23828125,
          "width": 0.5370370370370371,
          "height": 0.015104166666666667
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-900.woff2"
      },
      "cta": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.48,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#eceff0",
        "fitScore": 0.428,
        "sampleBox": {
          "x": 0.2935185185185185,
          "y": 0.9036458333333334,
          "width": 0.5657407407407408,
          "height": 0.017447916666666667
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-800.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-seller-consult-feed-097",
    "name": "Seller Consultation \u2014 Feed 097",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Homeowners thinking about selling and seeking expert guidance",
    "category": "seller-lead-generation",
    "tags": [
      "seller-consult",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-seller-consult-feed-097-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_097.png",
    "sourceHash": "095d0d876a1461184e3391a777128e95fac220a1ca002cd6211915d9cf9dcb83",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 38,
        "sample": "THINKING OF SELLING?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 37,
        "sample": "PLAN YOUR NEXT MOVE",
        "required": true
      },
      {
        "key": "agent_name",
        "label": "Agent Name",
        "maxLength": 29,
        "sample": "ALEX MORGAN",
        "required": true
      },
      {
        "key": "agent_role",
        "label": "Agent Role",
        "maxLength": 43,
        "sample": "LOCAL PROPERTY SPECIALIST",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 30,
        "sample": "0400 123 456",
        "required": true
      },
      {
        "key": "website",
        "label": "Website",
        "maxLength": 35,
        "sample": "youragency.com.au",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true,
        "box": {
          "x": 0.0185185185,
          "y": 0.4888888889,
          "width": 0.962962963,
          "height": 0.4933333333
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.7074074074,
          "y": 0.7985185185,
          "width": 0.2740740741,
          "height": 0.1674074074
        }
      }
    ],
    "typography": {
      "agent_role": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3557422969187678,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#474747",
        "fitScore": 0.4,
        "sampleBox": {
          "x": 0.3476851851851852,
          "y": 0.38555555555555554,
          "width": 0.31851851851851853,
          "height": 0.013333333333333334
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-700.woff2"
      },
      "headline": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.1851852782239995,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "center",
        "color": "#252525",
        "fitScore": 0.278,
        "sampleBox": {
          "x": 0.05324074074074074,
          "y": 0.09111111111111111,
          "width": 0.9004629629629629,
          "height": 0.1362962962962963
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-400.woff2"
      },
      "subheadline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5664961636828645,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#313131",
        "fitScore": 0.548,
        "sampleBox": {
          "x": 0.2537037037037037,
          "y": 0.25666666666666665,
          "width": 0.5032407407407408,
          "height": 0.022962962962962963
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-600.woff2"
      },
      "website": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 500,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.1290322580645162,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#505050",
        "fitScore": 0.638,
        "sampleBox": {
          "x": 0.2601851851851852,
          "y": 0.43037037037037035,
          "width": 0.2824074074074074,
          "height": 0.023333333333333334
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-500.woff2"
      },
      "phone": {
        "fontId": "barlow-condensed",
        "family": "Barlow Condensed",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.3719999999999999,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#363f40",
        "fitScore": 0.779,
        "sampleBox": {
          "x": 0.5856481481481481,
          "y": 0.42592592592592593,
          "width": 0.21342592592592594,
          "height": 0.03222222222222222
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/barlow-condensed-800.woff2"
      },
      "agent_name": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5394736842105265,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#2f2f2f",
        "fitScore": 0.583,
        "sampleBox": {
          "x": 0.32314814814814813,
          "y": 0.3433333333333333,
          "width": 0.37037037037037035,
          "height": 0.025925925925925925
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-600.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-seller-consult-feed-155",
    "name": "Seller Consultation \u2014 Feed 155",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Homeowners thinking about selling and seeking expert guidance",
    "category": "seller-lead-generation",
    "tags": [
      "seller-consult",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-seller-consult-feed-155-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_155.png",
    "sourceHash": "3e8c84ef23578e2299a69975fbff29919f0e6196917ee4de7271d6810434e27c",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 38,
        "sample": "THINKING OF SELLING?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 37,
        "sample": "PLAN YOUR NEXT MOVE",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 90,
        "sample": "Book a no-pressure seller consultation with a local property specialist.",
        "required": true
      },
      {
        "key": "benefit_1",
        "label": "Benefit 1",
        "maxLength": 32,
        "sample": "PRICE STRATEGY",
        "required": true
      },
      {
        "key": "benefit_2",
        "label": "Benefit 2",
        "maxLength": 34,
        "sample": "PREPARATION PLAN",
        "required": true
      },
      {
        "key": "benefit_3",
        "label": "Benefit 3",
        "maxLength": 34,
        "sample": "CLEAR NEXT STEPS",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 44,
        "sample": "BOOK A SELLER CONSULTATION",
        "required": true
      },
      {
        "key": "website",
        "label": "Website",
        "maxLength": 35,
        "sample": "youragency.com.au",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0599178022928832,
        "lineHeight": 1.424,
        "tracking": 0,
        "align": "center",
        "color": "#454545",
        "fitScore": 0.577,
        "sampleBox": {
          "x": 0.2777777777777778,
          "y": 0.6544444444444445,
          "width": 0.4462962962962963,
          "height": 0.046296296296296294
        },
        "sampleLineCount": 2,
        "detectionScore": 1
      },
      "cta": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.454246214614878,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#90948e",
        "fitScore": 0.202,
        "sampleBox": {
          "x": 0.01712962962962963,
          "y": 0.8633333333333333,
          "width": 0.9300925925925926,
          "height": 0.03037037037037037
        },
        "sampleLineCount": 6,
        "detectionScore": 0.654,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      },
      "headline": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.1887553256238585,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "left",
        "color": "#cbcac7",
        "fitScore": 0.238,
        "sampleBox": {
          "x": 0.11851851851851852,
          "y": 0.512962962962963,
          "width": 0.5805555555555556,
          "height": 0.08074074074074074
        },
        "sampleLineCount": 2,
        "detectionScore": 0.842,
        "fontFile": "/fonts/adstudio/oswald-700.woff2"
      },
      "subheadline": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3493253373313343,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "center",
        "color": "#232323",
        "fitScore": 0.416,
        "sampleBox": {
          "x": 0.31296296296296294,
          "y": 0.6144444444444445,
          "width": 0.3837962962962963,
          "height": 0.01925925925925926
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-800.woff2"
      },
      "website": {
        "fontId": "fira-sans",
        "family": "Fira Sans",
        "fallbackFamily": "sans-serif",
        "weight": 800,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.1605263157894739,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#515150",
        "fitScore": 0.722,
        "sampleBox": {
          "x": 0.24861111111111112,
          "y": 0.802962962962963,
          "width": 0.2740740740740741,
          "height": 0.012592592592592593
        },
        "sampleLineCount": 2,
        "detectionScore": 0.353,
        "fontFile": "/fonts/adstudio/fira-sans-800.woff2"
      },
      "benefit_2": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3888888888888888,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#454544",
        "fitScore": 0.545,
        "sampleBox": {
          "x": 0.43287037037037035,
          "y": 0.7837037037037037,
          "width": 0.2962962962962963,
          "height": 0.012222222222222223
        },
        "sampleLineCount": 2,
        "detectionScore": 0.824,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "benefit_3": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3125,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#4e4e4d",
        "fitScore": 0.424,
        "sampleBox": {
          "x": 0.6412037037037037,
          "y": 0.802962962962963,
          "width": 0.11574074074074074,
          "height": 0.012592592592592593
        },
        "sampleLineCount": 1,
        "detectionScore": 0.625,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "benefit_1": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.28125,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "right",
        "color": "#57583f",
        "fitScore": 0.428,
        "sampleBox": {
          "x": 0.2375,
          "y": 0.4292592592592593,
          "width": 0.6828703703703703,
          "height": 0.05333333333333334
        },
        "sampleLineCount": 6,
        "detectionScore": 0.357,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-700.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-seller-consult-feed-166",
    "name": "Seller Consultation \u2014 Feed 166",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Homeowners thinking about selling and seeking expert guidance",
    "category": "seller-lead-generation",
    "tags": [
      "seller-consult",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-seller-consult-feed-166-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_166.png",
    "sourceHash": "8d5be92bce991e7e107b8aa93ced81c46a8d1b0445759cdc831d4ffc8bb60d0b",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 38,
        "sample": "THINKING OF SELLING?",
        "required": true
      },
      {
        "key": "check_1",
        "label": "Check 1",
        "maxLength": 39,
        "sample": "CLARIFY YOUR TIMELINE",
        "required": true
      },
      {
        "key": "check_2",
        "label": "Check 2",
        "maxLength": 35,
        "sample": "PREPARE YOUR HOME",
        "required": true
      },
      {
        "key": "check_3",
        "label": "Check 3",
        "maxLength": 36,
        "sample": "REVIEW LOCAL SALES",
        "required": true
      },
      {
        "key": "check_4",
        "label": "Check 4",
        "maxLength": 38,
        "sample": "SET A PRICE STRATEGY",
        "required": true
      },
      {
        "key": "check_5",
        "label": "Check 5",
        "maxLength": 36,
        "sample": "PLAN YOUR CAMPAIGN",
        "required": true
      },
      {
        "key": "check_6",
        "label": "Check 6",
        "maxLength": 36,
        "sample": "CONFIRM NEXT STEPS",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 44,
        "sample": "BOOK A SELLER CONSULTATION",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 30,
        "sample": "0400 123 456",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "background_photo",
        "label": "Background photo",
        "required": true
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true
      }
    ],
    "typography": {
      "cta": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5017857142857143,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#dfe1e3",
        "fitScore": 0.45,
        "sampleBox": {
          "x": 0.3416666666666667,
          "y": 0.8774074074074074,
          "width": 0.4652777777777778,
          "height": 0.01888888888888889
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-700.woff2"
      },
      "check_1": {
        "fontId": "lora",
        "family": "Lora",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3212903225806452,
        "lineHeight": 1.28,
        "tracking": 0,
        "align": "center",
        "color": "#313132",
        "fitScore": 0.446,
        "sampleBox": {
          "x": 0.32407407407407407,
          "y": 0.3440740740740741,
          "width": 0.42916666666666664,
          "height": 0.02074074074074074
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/lora-700.woff2"
      },
      "headline": {
        "fontId": "quicksand",
        "family": "Quicksand",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3061224382702123,
        "lineHeight": 1.25,
        "tracking": 0,
        "align": "center",
        "color": "#1f3346",
        "fitScore": 0.586,
        "sampleBox": {
          "x": 0.20555555555555555,
          "y": 0.1451851851851852,
          "width": 0.6976851851851852,
          "height": 0.14185185185185184
        },
        "sampleLineCount": 3,
        "detectionScore": 0.864,
        "fontFile": "/fonts/adstudio/quicksand-300.woff2"
      },
      "check_4": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.4914394419784398,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "center",
        "color": "#dedad6",
        "fitScore": 0.168,
        "sampleBox": {
          "x": 0.0375,
          "y": 0.5014814814814815,
          "width": 0.8888888888888888,
          "height": 0.055185185185185184
        },
        "sampleLineCount": 3,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      },
      "check_3": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.572964669738863,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#2d2d2d",
        "fitScore": 0.438,
        "sampleBox": {
          "x": 0.325,
          "y": 0.47185185185185186,
          "width": 0.37407407407407406,
          "height": 0.02074074074074074
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-700.woff2"
      },
      "check_5": {
        "fontId": "lora",
        "family": "Lora",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3212903225806452,
        "lineHeight": 1.28,
        "tracking": 0,
        "align": "center",
        "color": "#2f2f2f",
        "fitScore": 0.428,
        "sampleBox": {
          "x": 0.325,
          "y": 0.6,
          "width": 0.38842592592592595,
          "height": 0.02074074074074074
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/lora-700.woff2"
      },
      "check_6": {
        "fontId": "lora",
        "family": "Lora",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3212903225806452,
        "lineHeight": 1.28,
        "tracking": 0,
        "align": "center",
        "color": "#303030",
        "fitScore": 0.435,
        "sampleBox": {
          "x": 0.32407407407407407,
          "y": 0.664074074074074,
          "width": 0.37453703703703706,
          "height": 0.021111111111111112
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/lora-700.woff2"
      },
      "check_2": {
        "fontId": "lora",
        "family": "Lora",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3212903225806452,
        "lineHeight": 1.28,
        "tracking": 0,
        "align": "center",
        "color": "#2c2c2c",
        "fitScore": 0.422,
        "sampleBox": {
          "x": 0.325,
          "y": 0.40814814814814815,
          "width": 0.3768518518518518,
          "height": 0.02074074074074074
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/lora-700.woff2"
      },
      "phone": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.2562292358803988,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#f0f1f2",
        "fitScore": 0.462,
        "sampleBox": {
          "x": 0.34120370370370373,
          "y": 0.912962962962963,
          "width": 0.4074074074074074,
          "height": 0.03666666666666667
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-700.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-seller-consult-feed-168",
    "name": "Seller Consultation \u2014 Feed 168",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Homeowners thinking about selling and seeking expert guidance",
    "category": "seller-lead-generation",
    "tags": [
      "seller-consult",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-seller-consult-feed-168-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_168.png",
    "sourceHash": "53180b93a24e4fa628bef61fa7c491e8586c53589622bb6699d1fdef9bb85b98",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 38,
        "sample": "THINKING OF SELLING?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 37,
        "sample": "PLAN YOUR NEXT MOVE",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 44,
        "sample": "BOOK A SELLER CONSULTATION",
        "required": true
      },
      {
        "key": "phone",
        "label": "Phone",
        "maxLength": 30,
        "sample": "0400 123 456",
        "required": true
      },
      {
        "key": "social_handle",
        "label": "Social Handle",
        "maxLength": 29,
        "sample": "@youragency",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo",
        "label": "Property photo",
        "required": true,
        "box": {
          "x": 0,
          "y": 0.5740740740740741,
          "width": 1,
          "height": 0.42592592592592593
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.812037037037037,
          "y": 0.052592592592592594,
          "width": 0.1388888888888889,
          "height": 0.11259259259259259
        }
      }
    ],
    "typography": {
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238094972059908,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#162734",
        "fitScore": 0.424,
        "sampleBox": {
          "x": 0.08055555555555556,
          "y": 0.06296296296296296,
          "width": 0.7129629629629629,
          "height": 0.27925925925925926
        },
        "sampleLineCount": 2,
        "detectionScore": 0.864,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.54406364749082,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#202b38",
        "fitScore": 0.619,
        "sampleBox": {
          "x": 0.07222222222222222,
          "y": 0.3648148148148148,
          "width": 0.8777777777777778,
          "height": 0.05592592592592593
        },
        "sampleLineCount": 1,
        "detectionScore": 0.947,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "phone": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.2623274161735698,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#202d35",
        "fitScore": 0.668,
        "sampleBox": {
          "x": 0.0824074074074074,
          "y": 0.45296296296296296,
          "width": 0.37453703703703706,
          "height": 0.05185185185185185
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-700.woff2"
      },
      "social_handle": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 500,
        "italic": false,
        "case": "lower",
        "sizeRatio": 0.9782608695652174,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "left",
        "color": "#252f3b",
        "fitScore": 0.574,
        "sampleBox": {
          "x": 0.6407407407407407,
          "y": 0.4674074074074074,
          "width": 0.24814814814814815,
          "height": 0.028888888888888888
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-500.woff2"
      },
      "cta": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.65,
        "lineHeight": 1.2,
        "tracking": 0.02,
        "align": "center",
        "color": "#162734",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.78,
          "width": 0.8,
          "height": 0.05
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-seller-consult-feed-174",
    "name": "Seller Consultation \u2014 Feed 174",
    "format": "4:5",
    "dimensions": {
      "width": 1080,
      "height": 1350
    },
    "audienceIntent": "Homeowners thinking about selling and seeking expert guidance",
    "category": "seller-lead-generation",
    "tags": [
      "seller-consult",
      "lead-generation",
      "feed"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-seller-consult-feed-174-sample.png",
    "sourceFile": "01_feed_4x5_best/meta_174.png",
    "sourceHash": "77c65c8e01558527417a316119fc76c2080b1182712da1b2e9e7f08549a8ef11",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 38,
        "sample": "THINKING OF SELLING?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 37,
        "sample": "PLAN YOUR NEXT MOVE",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 90,
        "sample": "Book a no-pressure seller consultation with a local property specialist.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 44,
        "sample": "BOOK A SELLER CONSULTATION",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo_1",
        "label": "Property photo 1",
        "required": true
      },
      {
        "key": "property_photo_2",
        "label": "Property photo 2",
        "required": true
      },
      {
        "key": "property_photo_3",
        "label": "Property photo 3",
        "required": true
      }
    ],
    "typography": {
      "body": {
        "fontId": "open-sans",
        "family": "Open Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1,
        "lineHeight": 1.36181640625,
        "tracking": 0,
        "align": "center",
        "color": "#d8dee2",
        "fitScore": 0.58,
        "sampleBox": {
          "x": 0.23657407407407408,
          "y": 0.2707407407407407,
          "width": 0.5421296296296296,
          "height": 0.05185185185185185
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/open-sans-300.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238094780260776,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#f1f1f0",
        "fitScore": 0.587,
        "sampleBox": {
          "x": 0.16805555555555557,
          "y": 0.052592592592592594,
          "width": 0.7064814814814815,
          "height": 0.1451851851851852
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "subheadline": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3827160493827158,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#e7eaec",
        "fitScore": 0.671,
        "sampleBox": {
          "x": 0.17685185185185184,
          "y": 0.22555555555555556,
          "width": 0.5546296296296296,
          "height": 0.01814814814814815
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "cta": {
        "fontId": "open-sans",
        "family": "Open Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.65,
        "lineHeight": 1.2,
        "tracking": 0.02,
        "align": "center",
        "color": "#d8dee2",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.78,
          "width": 0.8,
          "height": 0.05
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/open-sans-300.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-seller-consult-story-264",
    "name": "Seller Consultation \u2014 Story 264",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Homeowners thinking about selling and seeking expert guidance",
    "category": "seller-lead-generation",
    "tags": [
      "seller-consult",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-seller-consult-story-264-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_264.png",
    "sourceHash": "9fe7295b01dbb7ffe166c6cd1cba6660fc12e03251647fd8276a989d20c58987",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 38,
        "sample": "THINKING OF SELLING?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 37,
        "sample": "PLAN YOUR NEXT MOVE",
        "required": true
      },
      {
        "key": "benefit_1",
        "label": "Benefit 1",
        "maxLength": 32,
        "sample": "PRICE STRATEGY",
        "required": true
      },
      {
        "key": "benefit_2",
        "label": "Benefit 2",
        "maxLength": 34,
        "sample": "PREPARATION PLAN",
        "required": true
      },
      {
        "key": "benefit_3",
        "label": "Benefit 3",
        "maxLength": 34,
        "sample": "CLEAR NEXT STEPS",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 44,
        "sample": "BOOK A SELLER CONSULTATION",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "background_photo",
        "label": "Background photo",
        "required": true
      },
      {
        "key": "agent_portrait",
        "label": "Agent portrait",
        "required": true
      }
    ],
    "typography": {
      "headline": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 500,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3061224432788343,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "center",
        "color": "#5f524a",
        "fitScore": 0.841,
        "sampleBox": {
          "x": 0.0824074074074074,
          "y": 0.38723958333333336,
          "width": 0.8671296296296296,
          "height": 0.19661458333333334
        },
        "sampleLineCount": 2,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-500.woff2"
      },
      "subheadline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5394736842105265,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#403e3c",
        "fitScore": 0.593,
        "sampleBox": {
          "x": 0.20833333333333334,
          "y": 0.6049479166666667,
          "width": 0.6199074074074075,
          "height": 0.018229166666666668
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-600.woff2"
      },
      "benefit_2": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.32,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#42413f",
        "fitScore": 0.512,
        "sampleBox": {
          "x": 0.3212962962962963,
          "y": 0.7510416666666667,
          "width": 0.41064814814814815,
          "height": 0.015104166666666667
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-600.woff2"
      },
      "benefit_3": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238096120245916,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#d1cecc",
        "fitScore": 0.347,
        "sampleBox": {
          "x": 0.24166666666666667,
          "y": 0.7518229166666667,
          "width": 0.47824074074074074,
          "height": 0.08515625
        },
        "sampleLineCount": 2,
        "detectionScore": 0.813,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "benefit_1": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.546875,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#444240",
        "fitScore": 0.525,
        "sampleBox": {
          "x": 0.3212962962962963,
          "y": 0.6799479166666667,
          "width": 0.3453703703703704,
          "height": 0.015104166666666667
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-600.woff2"
      },
      "cta": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.65,
        "lineHeight": 1.2,
        "tracking": 0.02,
        "align": "center",
        "color": "#5f524a",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.78,
          "width": 0.8,
          "height": 0.05
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-seller-consult-story-270",
    "name": "Seller Consultation \u2014 Story 270",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Homeowners thinking about selling and seeking expert guidance",
    "category": "seller-lead-generation",
    "tags": [
      "seller-consult",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-seller-consult-story-270-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_270.png",
    "sourceHash": "7690271f39f161134f97a8debdb403ccf4d6da32990da3d1770b636aaecbd915",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 38,
        "sample": "THINKING OF SELLING?",
        "required": true
      },
      {
        "key": "subheadline",
        "label": "Subheadline",
        "maxLength": 37,
        "sample": "PLAN YOUR NEXT MOVE",
        "required": true
      },
      {
        "key": "body",
        "label": "Body",
        "maxLength": 90,
        "sample": "Book a no-pressure seller consultation with a local property specialist.",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 44,
        "sample": "BOOK A SELLER CONSULTATION",
        "required": true
      },
      {
        "key": "website",
        "label": "Website",
        "maxLength": 35,
        "sample": "youragency.com.au",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_photo_1",
        "label": "Property photo 1",
        "required": true,
        "box": {
          "x": 0.001851851851851852,
          "y": 0.19427083333333334,
          "width": 0.49166666666666664,
          "height": 0.4005208333333333
        }
      },
      {
        "key": "property_photo_2",
        "label": "Property photo 2",
        "required": true,
        "box": {
          "x": 0.5064814814814815,
          "y": 0.19427083333333334,
          "width": 0.49166666666666664,
          "height": 0.4005208333333333
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.4287037037037037,
          "y": 0.05416666666666667,
          "width": 0.14,
          "height": 0.0734375
        }
      }
    ],
    "typography": {
      "body": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0506329113924051,
        "lineHeight": 1.424,
        "tracking": 0,
        "align": "center",
        "color": "#5c6772",
        "fitScore": 0.617,
        "sampleBox": {
          "x": 0.23194444444444445,
          "y": 0.7822916666666667,
          "width": 0.5444444444444444,
          "height": 0.03828125
        },
        "sampleLineCount": 2,
        "detectionScore": 1
      },
      "cta": {
        "fontId": "google-sans",
        "family": "Google Sans",
        "fallbackFamily": "sans-serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2706766917293233,
        "lineHeight": 1.252,
        "tracking": 0,
        "align": "center",
        "color": "#d2d6d9",
        "fitScore": 0.502,
        "sampleBox": {
          "x": 0.25925925925925924,
          "y": 0.8734375,
          "width": 0.4912037037037037,
          "height": 0.01171875
        },
        "sampleLineCount": 1,
        "detectionScore": 1
      },
      "headline": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3337164750957855,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "center",
        "color": "#1d3443",
        "fitScore": 0.672,
        "sampleBox": {
          "x": 0.11342592592592593,
          "y": 0.665625,
          "width": 0.7972222222222223,
          "height": 0.026822916666666665
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-600.woff2"
      },
      "subheadline": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.2767462422634834,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "center",
        "color": "#ebba57",
        "fitScore": 0.595,
        "sampleBox": {
          "x": 0.21712962962962962,
          "y": 0.7239583333333334,
          "width": 0.5861111111111111,
          "height": 0.01796875
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-700.woff2"
      },
      "website": {
        "fontId": "lora",
        "family": "Lora",
        "fallbackFamily": "serif",
        "weight": 700,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.0769230769230769,
        "lineHeight": 1.28,
        "tracking": 0,
        "align": "center",
        "color": "#505d69",
        "fitScore": 0.598,
        "sampleBox": {
          "x": 0.35462962962962963,
          "y": 0.94296875,
          "width": 0.28703703703703703,
          "height": 0.012760416666666666
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/lora-700.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-seller-consult-story-323",
    "name": "Seller Consultation \u2014 Story 323",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Homeowners thinking about selling and seeking expert guidance",
    "category": "seller-lead-generation",
    "tags": [
      "seller-consult",
      "lead-generation",
      "story"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-seller-consult-story-323-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_323.png",
    "sourceHash": "9e35b39addc663b0a669436ad265c9e0ca5f9173c584e879ff3c78ace9679b60",
    "textInputs": [
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 38,
        "sample": "THINKING OF SELLING?",
        "required": true
      },
      {
        "key": "check_1",
        "label": "Check 1",
        "maxLength": 39,
        "sample": "CLARIFY YOUR TIMELINE",
        "required": true
      },
      {
        "key": "check_2",
        "label": "Check 2",
        "maxLength": 35,
        "sample": "PREPARE YOUR HOME",
        "required": true
      },
      {
        "key": "check_3",
        "label": "Check 3",
        "maxLength": 36,
        "sample": "REVIEW LOCAL SALES",
        "required": true
      },
      {
        "key": "check_4",
        "label": "Check 4",
        "maxLength": 38,
        "sample": "SET A PRICE STRATEGY",
        "required": true
      },
      {
        "key": "check_5",
        "label": "Check 5",
        "maxLength": 36,
        "sample": "PLAN YOUR CAMPAIGN",
        "required": true
      },
      {
        "key": "check_6",
        "label": "Check 6",
        "maxLength": 36,
        "sample": "CONFIRM NEXT STEPS",
        "required": true
      },
      {
        "key": "cta",
        "label": "Cta",
        "maxLength": 44,
        "sample": "BOOK A SELLER CONSULTATION",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "background_photo",
        "label": "Background photo",
        "required": true,
        "box": {
          "x": 0,
          "y": 0,
          "width": 1,
          "height": 0.2979166667
        }
      },
      {
        "key": "agency_logo",
        "label": "Agency logo",
        "required": true,
        "box": {
          "x": 0.0685185185,
          "y": 0.85625,
          "width": 0.1731481481,
          "height": 0.0979166667
        }
      }
    ],
    "typography": {
      "cta": {
        "fontId": "raleway",
        "family": "Raleway",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.3617020308578727,
        "lineHeight": 1.174,
        "tracking": 0,
        "align": "center",
        "color": "#3d4e51",
        "fitScore": 0.795,
        "sampleBox": {
          "x": 0.10185185185185185,
          "y": 0.86484375,
          "width": 0.8342592592592593,
          "height": 0.08645833333333333
        },
        "sampleLineCount": 4,
        "detectionScore": 0.813,
        "fontFile": "/fonts/adstudio/raleway-900.woff2"
      },
      "check_1": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5454545454545454,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#4f4f4e",
        "fitScore": 0.621,
        "sampleBox": {
          "x": 0.1875,
          "y": 0.51640625,
          "width": 0.5231481481481481,
          "height": 0.015885416666666666
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-600.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238094223673646,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#484747",
        "fitScore": 0.587,
        "sampleBox": {
          "x": 0.0824074074074074,
          "y": 0.33515625,
          "width": 0.7875,
          "height": 0.13854166666666667
        },
        "sampleLineCount": 2,
        "detectionScore": 0.842,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "check_4": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5454545454545454,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#4f4f4f",
        "fitScore": 0.581,
        "sampleBox": {
          "x": 0.1875,
          "y": 0.6682291666666667,
          "width": 0.487962962962963,
          "height": 0.015885416666666666
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-600.woff2"
      },
      "check_3": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5454545454545454,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#504f4f",
        "fitScore": 0.573,
        "sampleBox": {
          "x": 0.18935185185185185,
          "y": 0.6177083333333333,
          "width": 0.46111111111111114,
          "height": 0.015885416666666666
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-600.woff2"
      },
      "check_5": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5423728813559323,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#666666",
        "fitScore": 0.751,
        "sampleBox": {
          "x": 0.10648148148148148,
          "y": 0.7005208333333334,
          "width": 0.5611111111111111,
          "height": 0.04140625
        },
        "sampleLineCount": 1,
        "detectionScore": 0.857,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "check_6": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.466860465116279,
        "lineHeight": 1.424,
        "tracking": 0,
        "align": "left",
        "color": "#676766",
        "fitScore": 0.724,
        "sampleBox": {
          "x": 0.10416666666666667,
          "y": 0.7515625,
          "width": 0.55,
          "height": 0.039322916666666666
        },
        "sampleLineCount": 1,
        "detectionScore": 0.857
      },
      "check_2": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5454545454545454,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#504f4f",
        "fitScore": 0.582,
        "sampleBox": {
          "x": 0.18935185185185185,
          "y": 0.5669270833333333,
          "width": 0.4601851851851852,
          "height": 0.015885416666666666
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-600.woff2"
      }
    },
    "deterministicStatus": "partial"
  },
  {
    "id": "meta-stories-245",
    "name": "Looking for a Real Estate Agent?",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "People seeking to buy or sell a home and looking for an agent",
    "category": "real_estate",
    "tags": [
      "real estate",
      "agent",
      "buyer",
      "seller",
      "contact",
      "viewing",
      "service"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-stories-245-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_245.png",
    "sourceHash": "b6d85d3015a97438faaf619b460f78f24ebc4c0d22a3e471575d105d6f65141e",
    "textInputs": [
      {
        "key": "agency_name",
        "label": "Agency Name",
        "maxLength": 30,
        "sample": "HARBOURLINE REALTY",
        "required": true
      },
      {
        "key": "service_tagline",
        "label": "Service Tagline",
        "maxLength": 30,
        "sample": "Best Service",
        "required": false
      },
      {
        "key": "headline",
        "label": "Headline",
        "maxLength": 60,
        "sample": "LOOKING FOR A REAL ESTATE AGENT?",
        "required": true
      },
      {
        "key": "supporting_text",
        "label": "Supporting Text",
        "maxLength": 90,
        "sample": "We are ready to help you with the buying or selling of your home.",
        "required": true
      },
      {
        "key": "agent_name",
        "label": "Agent Name",
        "maxLength": 40,
        "sample": "Mia Calloway",
        "required": true
      },
      {
        "key": "agent_title",
        "label": "Agent Title",
        "maxLength": 30,
        "sample": "Real Estate Agent",
        "required": true
      },
      {
        "key": "cta_text",
        "label": "Call to Action Text",
        "maxLength": 40,
        "sample": "Schedule a Viewing",
        "required": true
      },
      {
        "key": "contact_number",
        "label": "Contact Number",
        "maxLength": 20,
        "sample": "+123-555-0134",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "agency_logo",
        "label": "Agency Logo",
        "required": true
      },
      {
        "key": "agent_photo",
        "label": "Agent Photo",
        "required": true
      }
    ],
    "typography": {
      "supporting_text": {
        "fontId": "archivo",
        "family": "Archivo",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0960746233521657,
        "lineHeight": 1.088,
        "tracking": 0,
        "align": "left",
        "color": "#aca9a9",
        "fitScore": 0.41,
        "sampleBox": {
          "x": 0.0849609375,
          "y": 0.4498697916666667,
          "width": 0.5908203125,
          "height": 0.10904947916666667
        },
        "sampleLineCount": 5,
        "detectionScore": 0.914,
        "fontFile": "/fonts/adstudio/archivo-300.woff2"
      },
      "headline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5238096002946857,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#26474d",
        "fitScore": 0.41,
        "sampleBox": {
          "x": 0.0751953125,
          "y": 0.14290364583333334,
          "width": 0.8349609375,
          "height": 0.2138671875
        },
        "sampleLineCount": 3,
        "detectionScore": 0.968,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      },
      "agency_name": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 400,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.5510204081632653,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "left",
        "color": "#444345",
        "fitScore": 0.521,
        "sampleBox": {
          "x": 0.2099609375,
          "y": 0.061197916666666664,
          "width": 0.24658203125,
          "height": 0.04296875
        },
        "sampleLineCount": 2,
        "detectionScore": 0.889,
        "fontFile": "/fonts/adstudio/smooch-sans-400.woff2"
      },
      "cta_text": {
        "fontId": "poppins",
        "family": "Poppins",
        "fallbackFamily": "sans-serif",
        "weight": 500,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 0.9540846750149076,
        "lineHeight": 1.5,
        "tracking": 0,
        "align": "left",
        "color": "#d9e6e9",
        "fitScore": 0.602,
        "sampleBox": {
          "x": 0.20166015625,
          "y": 0.8987630208333334,
          "width": 0.32763671875,
          "height": 0.0234375
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/poppins-500.woff2"
      },
      "agent_title": {
        "fontId": "manrope",
        "family": "Manrope",
        "fallbackFamily": "sans-serif",
        "weight": 500,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0004728132387706,
        "lineHeight": 1.366,
        "tracking": 0,
        "align": "left",
        "color": "#e3e4e4",
        "fitScore": 0.598,
        "sampleBox": {
          "x": 0.083984375,
          "y": 0.8050130208333334,
          "width": 0.3271484375,
          "height": 0.026041666666666668
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/manrope-500.woff2"
      },
      "contact_number": {
        "fontId": "roboto-slab",
        "family": "Roboto Slab",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.3157894736842106,
        "lineHeight": 1.31884765625,
        "tracking": 0,
        "align": "left",
        "color": "#f0f5f6",
        "fitScore": 0.456,
        "sampleBox": {
          "x": 0.19970703125,
          "y": 0.9329427083333334,
          "width": 0.4375,
          "height": 0.028645833333333332
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/roboto-slab-800.woff2"
      },
      "agent_name": {
        "fontId": "oswald",
        "family": "Oswald",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0135135135135136,
        "lineHeight": 1.482,
        "tracking": 0,
        "align": "left",
        "color": "#f3f3f3",
        "fitScore": 0.594,
        "sampleBox": {
          "x": 0.08447265625,
          "y": 0.7545572916666666,
          "width": 0.4482421875,
          "height": 0.042643229166666664
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/oswald-600.woff2"
      },
      "service_tagline": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "measurementSource": "manual-estimate",
        "sizeRatio": 0.55,
        "lineHeight": 1.2,
        "tracking": 0.01,
        "align": "center",
        "color": "#aca9a9",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.1,
          "y": 0.7,
          "width": 0.8,
          "height": 0.04
        },
        "sampleLineCount": 1,
        "detectionScore": 0.55,
        "fontFile": "/fonts/adstudio/smooch-sans-300.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-stories-255",
    "name": "Market Report Snapshot",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Stay informed about the latest real estate market trends and statistics.",
    "category": "market_update",
    "tags": [
      "market report",
      "real estate",
      "statistics",
      "property update",
      "agent branding"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-stories-255-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_255.png",
    "sourceHash": "64fdbd93d4d5f3e7fc6d062762fd50b9dd8ece96ab85e3c011a28346072fda71",
    "textInputs": [
      {
        "key": "time_on_market",
        "label": "Time on Market",
        "maxLength": 20,
        "sample": "9 DAYS",
        "required": true
      },
      {
        "key": "average_price",
        "label": "Average Price",
        "maxLength": 20,
        "sample": "$742,000",
        "required": true
      },
      {
        "key": "new_listings",
        "label": "New Listings",
        "maxLength": 10,
        "sample": "126",
        "required": true
      },
      {
        "key": "sold_listings",
        "label": "Sold Listings",
        "maxLength": 10,
        "sample": "38",
        "required": true
      },
      {
        "key": "social_handle",
        "label": "Social Handle or Website",
        "maxLength": 50,
        "sample": "@harbourline.example",
        "required": false
      },
      {
        "key": "agent_name",
        "label": "Agent Name",
        "maxLength": 40,
        "sample": "Elena Marsh",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "property_image",
        "label": "Featured Property Image",
        "required": true
      },
      {
        "key": "agent_photo",
        "label": "Agent Photo",
        "required": true
      }
    ],
    "typography": {
      "social_handle": {
        "fontId": "plus-jakarta-sans",
        "family": "Plus Jakarta Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.0012771392081736,
        "lineHeight": 1.26,
        "tracking": 0,
        "align": "center",
        "color": "#787776",
        "fitScore": 0.661,
        "sampleBox": {
          "x": 0.17626953125,
          "y": 0.751953125,
          "width": 0.6572265625,
          "height": 0.015625
        },
        "sampleLineCount": 1,
        "detectionScore": 0.388,
        "fontFile": "/fonts/adstudio/plus-jakarta-sans-600.woff2"
      },
      "agent_name": {
        "fontId": "quicksand",
        "family": "Quicksand",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.3261746143057502,
        "lineHeight": 1.25,
        "tracking": 0,
        "align": "left",
        "color": "#7e7c7b",
        "fitScore": 0.59,
        "sampleBox": {
          "x": 0.560546875,
          "y": 0.8411458333333334,
          "width": 0.29638671875,
          "height": 0.06966145833333333
        },
        "sampleLineCount": 1,
        "detectionScore": 0.545,
        "fontFile": "/fonts/adstudio/quicksand-300.woff2"
      },
      "average_price": {
        "fontId": "roboto-mono",
        "family": "Roboto Mono",
        "fallbackFamily": "monospace",
        "weight": 600,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.0108173076923077,
        "lineHeight": 1.31884765625,
        "tracking": 0,
        "align": "left",
        "color": "#6c6b6c",
        "fitScore": 0.608,
        "sampleBox": {
          "x": 0.71630859375,
          "y": 0.55859375,
          "width": 0.12109375,
          "height": 0.0166015625
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/roboto-mono-600.woff2"
      },
      "time_on_market": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.1925465838509315,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#6b6a6a",
        "fitScore": 0.456,
        "sampleBox": {
          "x": 0.73876953125,
          "y": 0.4973958333333333,
          "width": 0.09814453125,
          "height": 0.013020833333333334
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "new_listings": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.224537037037037,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#676667",
        "fitScore": 0.428,
        "sampleBox": {
          "x": 0.7939453125,
          "y": 0.6223958333333334,
          "width": 0.04443359375,
          "height": 0.0126953125
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      },
      "sold_listings": {
        "fontId": "merriweather",
        "family": "Merriweather",
        "fallbackFamily": "serif",
        "weight": 800,
        "italic": false,
        "case": "none",
        "sizeRatio": 1.391304347826087,
        "lineHeight": 1.257,
        "tracking": 0,
        "align": "left",
        "color": "#6f6e6f",
        "fitScore": 0.35,
        "sampleBox": {
          "x": 0.80859375,
          "y": 0.6803385416666666,
          "width": 0.0283203125,
          "height": 0.013020833333333334
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/merriweather-800.woff2"
      }
    },
    "deterministicStatus": "none"
  },
  {
    "id": "meta-stories-262",
    "name": "Buyer Tip - Get Pre-Approved",
    "format": "9:16",
    "dimensions": {
      "width": 1080,
      "height": 1920
    },
    "audienceIntent": "Prospective home buyers seeking advice on starting the buying process",
    "category": "real_estate",
    "tags": [
      "buyer tip",
      "pre-approval",
      "home buying",
      "real estate advice"
    ],
    "sampleSrc": "/adstudio-samples/meta/meta-stories-262-sample.png",
    "sourceFile": "02_stories_reels_9x16/meta_262.png",
    "sourceHash": "27a5dc43ed7c200505f876d6a46ad8b8dc792c31e85d2ae9803c209540d2b21e",
    "textInputs": [
      {
        "key": "main_heading",
        "label": "Main Heading",
        "maxLength": 20,
        "sample": "BUYER TIP",
        "required": true
      },
      {
        "key": "tip_text",
        "label": "Tip Text",
        "maxLength": 240,
        "sample": "Get pre-approved before you start house hunting. It locks in your budget and lets you make an offer the moment you find the right home.",
        "required": true
      },
      {
        "key": "contact_handle",
        "label": "Contact Handle or Website",
        "maxLength": 40,
        "sample": "@brightside.example",
        "required": true
      }
    ],
    "imageInputs": [
      {
        "key": "agent_photo",
        "label": "Agent or Professional Portrait",
        "required": true
      }
    ],
    "typography": {
      "tip_text": {
        "fontId": "source-sans-3",
        "family": "Source Sans 3",
        "fallbackFamily": "sans-serif",
        "weight": 300,
        "italic": false,
        "case": "mixed",
        "sizeRatio": 1.0363837489943684,
        "lineHeight": 1.424,
        "tracking": 0,
        "align": "center",
        "color": "#d1d1d1",
        "fitScore": 0.556,
        "sampleBox": {
          "x": 0.16943359375,
          "y": 0.7584635416666666,
          "width": 0.68798828125,
          "height": 0.12858072916666666
        },
        "sampleLineCount": 4,
        "detectionScore": 1
      },
      "contact_handle": {
        "fontId": "smooch-sans",
        "family": "Smooch Sans",
        "fallbackFamily": "sans-serif",
        "weight": 600,
        "italic": false,
        "case": "lower",
        "sizeRatio": 1.3255172413793102,
        "lineHeight": 1.2,
        "tracking": 0,
        "align": "center",
        "color": "#d7d7d8",
        "fitScore": 0.638,
        "sampleBox": {
          "x": 0.333984375,
          "y": 0.9280598958333334,
          "width": 0.32666015625,
          "height": 0.017903645833333332
        },
        "sampleLineCount": 1,
        "detectionScore": 1,
        "fontFile": "/fonts/adstudio/smooch-sans-600.woff2"
      },
      "main_heading": {
        "fontId": "kanit",
        "family": "Kanit",
        "fallbackFamily": "sans-serif",
        "weight": 900,
        "italic": false,
        "case": "upper",
        "sizeRatio": 1.52,
        "lineHeight": 1.495,
        "tracking": 0,
        "align": "left",
        "color": "#6f6458",
        "fitScore": 0.133,
        "sampleBox": {
          "x": 0.267578125,
          "y": 0.1416015625,
          "width": 0.1533203125,
          "height": 0.022135416666666668
        },
        "sampleLineCount": 2,
        "detectionScore": 0.444,
        "fontFile": "/fonts/adstudio/kanit-900.woff2"
      }
    },
    "deterministicStatus": "none"
  }
];
