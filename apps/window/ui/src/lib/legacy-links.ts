// Destinations that still render in the classic Frank window, grouped by area.
// Each is a full navigation until the view is rebuilt inside the shell.
export type LegacyLink = { href: string; label: string; detail: string }

export const CONTENT_LINKS: LegacyLink[] = [
  { href: "/blog-studio", label: "Blog Studio", detail: "Briefs, drafts, source checks and delivery." },
  { href: "/ad-template-generator", label: "Ad Template Generator", detail: "Template packs, variants and QA." },
  { href: "/ad-radar", label: "Ad Radar", detail: "Observed ads, filters and research reports." },
  { href: "/ad-db", label: "Ad database", detail: "Creative assets, search and evidence." },
]

export const TOOL_LINKS: LegacyLink[] = [
  { href: "/hub", label: "Chats and projects", detail: "Hermes conversations and every project home." },
  { href: "/files", label: "Files", detail: "Uploads and shared files." },
  { href: "/connections", label: "Connections", detail: "Provider connections and their status." },
  { href: "/accounts", label: "Accounts", detail: "Account records the connections use." },
  { href: "/trace", label: "Trace", detail: "Runs, evidence and audit trail." },
  { href: "/releases", label: "Releases", detail: "Deployed revisions and release records." },
  { href: "/ops", label: "Ops", detail: "Operator console." },
  { href: "/live", label: "Live", detail: "Live view." },
  { href: "/map", label: "Map", detail: "Map view." },
  { href: "/control", label: "Control", detail: "Control plane." },
  { href: "/project/blockwise?technical=1", label: "Blockwise technical view", detail: "The technical project home for Blockwise." },
]

