// Temporary home sidebar data until chat history and schedule APIs exist.
export const recentChats = [
  { id: "continue-frank-hub-build", title: "Continue Frank Hub build" },
  { id: "hermes-operator-mode", title: "Hermes operator mode" },
  { id: "cloudflare-domain-setup", title: "Cloudflare domain setup" }
] as const;

export const upcomingItems = [
  { id: "competitor-landscape-scan", title: "Competitor landscape scan", timeLabel: "Today 10:30 AM" },
  { id: "weekly-intelligence-digest", title: "Weekly intelligence digest", timeLabel: "Tomorrow 2:00 PM" },
  { id: "board-briefing-draft", title: "Board briefing draft", timeLabel: "May 14 11:00 AM" }
] as const;
