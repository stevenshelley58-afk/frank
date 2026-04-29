import {
  Activity,
  Bot,
  Boxes,
  FileClock,
  Hammer,
  ListTodo,
  PlugZap,
  Settings as SettingsIcon,
  TerminalSquare
} from "lucide-react";
import { useState } from "react";
import { AppShell, type AppShellPage } from "./components/layout/index.js";
import {
  AgentsPage,
  AuditLogPage,
  DashboardPage,
  HermesPage,
  ModelsPage,
  OpsConsolePage,
  ProvidersPage,
  SettingsPage,
  TasksPage
} from "./pages/index.js";

const pages: AppShellPage[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    title: "System Dashboard",
    description: "Private infrastructure status for the Frank Hub control plane.",
    icon: Activity
  },
  {
    id: "tasks",
    label: "Tasks",
    title: "Tasks",
    description: "Manual task intake and conservative state tracking without agent execution.",
    icon: ListTodo
  },
  {
    id: "agents",
    label: "Agents",
    title: "Agents",
    description: "Operator-facing registry for future agent surfaces and approval boundaries.",
    icon: Bot
  },
  {
    id: "models",
    label: "Models",
    title: "Models",
    description: "Model-role control plane without hardcoded concrete model selections.",
    icon: Boxes
  },
  {
    id: "providers",
    label: "Providers",
    title: "Providers",
    description: "Provider registry planning without runtime provider wiring.",
    icon: PlugZap
  },
  {
    id: "audit-log",
    label: "Audit Log",
    title: "Audit Log",
    description: "Reviewable operational events and system activity.",
    icon: FileClock
  },
  {
    id: "ops-console",
    label: "Ops Console",
    title: "Ops Console",
    description: "Read-only service, system, and deploy posture for Frank Hub.",
    icon: TerminalSquare
  },
  {
    id: "hermes",
    label: "Hermes",
    title: "Hermes Runner",
    description: "Private operator runtime status and configuration summary.",
    icon: Hammer
  },
  {
    id: "settings",
    label: "Settings",
    title: "Settings",
    description: "Dashboard endpoints, access posture, and guardrail visibility.",
    icon: SettingsIcon
  }
];

export function App() {
  const [activePageId, setActivePageId] = useState(pages[0]!.id);

  return (
    <AppShell pages={pages} activePageId={activePageId} onNavigate={setActivePageId}>
      {renderPage(activePageId)}
    </AppShell>
  );
}

function renderPage(pageId: string) {
  switch (pageId) {
    case "tasks":
      return <TasksPage />;
    case "agents":
      return <AgentsPage />;
    case "models":
      return <ModelsPage />;
    case "providers":
      return <ProvidersPage />;
    case "audit-log":
      return <AuditLogPage />;
    case "ops-console":
      return <OpsConsolePage />;
    case "hermes":
      return <HermesPage />;
    case "settings":
      return <SettingsPage />;
    case "dashboard":
    default:
      return <DashboardPage />;
  }
}
