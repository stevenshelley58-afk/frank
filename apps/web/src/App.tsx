import {
  Activity,
  Bot,
  Boxes,
  BookOpen,
  FileClock,
  Folder,
  Hammer,
  Home,
  ListTodo,
  PlugZap,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  TerminalSquare
} from "lucide-react";
import { useState } from "react";
import { AppShell, type AppShellPage } from "./components/layout/index.js";
import type { HomeSelection } from "./lib/home-context.js";
import {
  AgentsPage,
  AuditLogPage,
  DashboardPage,
  HermesPage,
  HomePage,
  LibraryPage,
  ModelsPage,
  OpsConsolePage,
  ProjectsPage,
  ProvidersPage,
  RulesPage,
  SettingsPage,
  SkillsPage,
  TasksPage
} from "./pages/index.js";

const pages: AppShellPage[] = [
  {
    id: "home",
    label: "Home",
    title: "Home",
    description: "Chat-first command center for Frank Hub.",
    icon: Home
  },
  {
    id: "projects",
    label: "Projects",
    title: "Projects",
    description: "Project workspace surface.",
    icon: Folder
  },
  {
    id: "library",
    label: "Library",
    title: "Library",
    description: "Existing Frank Hub pages and records.",
    icon: BookOpen
  },
  {
    id: "skills",
    label: "Skills",
    title: "Skills",
    description: "Agent capability and skill surfaces.",
    icon: Sparkles
  },
  {
    id: "rules",
    label: "Rules",
    title: "Rules",
    description: "Guardrails, access, and review boundaries.",
    icon: ShieldCheck
  },
  {
    id: "tasks",
    label: "Tasks",
    title: "Tasks",
    description: "Manual task intake and conservative state tracking without agent execution.",
    icon: ListTodo,
    placement: "hidden"
  },
  {
    id: "agents",
    label: "Agents",
    title: "Agents",
    description: "Operator-facing registry for future agent surfaces and approval boundaries.",
    icon: Bot,
    placement: "hidden"
  },
  {
    id: "models",
    label: "Models",
    title: "Models",
    description: "Model-role control plane without hardcoded concrete model selections.",
    icon: Boxes,
    placement: "hidden"
  },
  {
    id: "providers",
    label: "Providers",
    title: "Providers",
    description: "Provider registry planning without runtime provider wiring.",
    icon: PlugZap,
    placement: "hidden"
  },
  {
    id: "audit-log",
    label: "Audit Log",
    title: "Audit Log",
    description: "Reviewable operational events and system activity.",
    icon: FileClock,
    placement: "hidden"
  },
  {
    id: "dashboard",
    label: "Legacy Dashboard",
    title: "Legacy Dashboard",
    description: "Private infrastructure status for the Frank Hub control plane.",
    icon: Activity,
    placement: "hidden"
  },
  {
    id: "ops-console",
    label: "Ops Console",
    title: "Ops Console",
    description: "Read-only service, system, and deploy posture for Frank Hub.",
    icon: TerminalSquare,
    placement: "hidden"
  },
  {
    id: "hermes",
    label: "Hermes",
    title: "Hermes Runner",
    description: "Private operator runtime status and configuration summary.",
    icon: Hammer,
    placement: "hidden"
  },
  {
    id: "settings",
    label: "Settings",
    title: "Settings",
    description: "Dashboard endpoints, access posture, and guardrail visibility.",
    icon: SettingsIcon,
    placement: "settings"
  }
];

export function App() {
  const [activePageId, setActivePageId] = useState("home");
  const [homeSelection, setHomeSelection] = useState<HomeSelection | null>(null);

  return (
    <AppShell
      pages={pages}
      activePageId={activePageId}
      onNavigate={setActivePageId}
      onHomeContextSelect={setHomeSelection}
    >
      {renderPage(activePageId, homeSelection, setHomeSelection, setActivePageId)}
    </AppShell>
  );
}

function renderPage(
  pageId: string,
  homeSelection: HomeSelection | null,
  setHomeSelection: (selection: HomeSelection | null) => void,
  navigate: (pageId: string) => void
) {
  switch (pageId) {
    case "projects":
      return <ProjectsPage />;
    case "library":
      return <LibraryPage onNavigate={navigate} />;
    case "skills":
      return <SkillsPage onNavigate={navigate} />;
    case "rules":
      return <RulesPage onNavigate={navigate} />;
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
    case "dashboard":
      return <DashboardPage />;
    case "ops-console":
      return <OpsConsolePage />;
    case "hermes":
      return <HermesPage />;
    case "settings":
      return <SettingsPage />;
    case "home":
    default:
      return <HomePage selection={homeSelection} onSelectionChange={setHomeSelection} />;
  }
}
