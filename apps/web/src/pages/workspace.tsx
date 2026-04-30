import { BookOpen, Bot, Boxes, FileClock, Folder, ListTodo, Route, ShieldCheck, TerminalSquare } from "lucide-react";
import { Button } from "../components/ui/index.js";
import { SectionCard } from "../components/dashboard/index.js";

export function ProjectsPage() {
  return (
    <section className="mx-auto grid w-full max-w-4xl gap-5">
      <SectionCard title="Projects" description="Project workspace surface for Frank Hub." icon={<Folder aria-hidden="true" />}>
        <p className="text-sm leading-6 text-muted-foreground">
          Project records are not wired to a backend API yet. Use Home or Tasks to start work without adding new runtime capability.
        </p>
      </SectionCard>
    </section>
  );
}

export function SkillsPage({ onNavigate }: { onNavigate: (pageId: string) => void }) {
  return (
    <section className="mx-auto grid w-full max-w-4xl gap-5">
      <SectionCard title="Skills" description="Skill and agent capability surfaces." icon={<Bot aria-hidden="true" />}>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => onNavigate("agents")}>
            <Bot aria-hidden="true" />
            Agents
          </Button>
          <Button type="button" variant="outline" onClick={() => onNavigate("models")}>
            <Boxes aria-hidden="true" />
            Model roles
          </Button>
        </div>
      </SectionCard>
    </section>
  );
}

export function RulesPage({ onNavigate }: { onNavigate: (pageId: string) => void }) {
  return (
    <section className="mx-auto grid w-full max-w-4xl gap-5">
      <SectionCard title="Rules" description="Guardrails, access, and review boundaries." icon={<ShieldCheck aria-hidden="true" />}>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => onNavigate("settings")}>
            <ShieldCheck aria-hidden="true" />
            Settings
          </Button>
          <Button type="button" variant="outline" onClick={() => onNavigate("audit-log")}>
            <FileClock aria-hidden="true" />
            Audit log
          </Button>
        </div>
      </SectionCard>
    </section>
  );
}

export function LibraryPage({ onNavigate }: { onNavigate: (pageId: string) => void }) {
  const entries = [
    { id: "tasks", label: "Tasks", icon: ListTodo },
    { id: "agents", label: "Agents", icon: Bot },
    { id: "models", label: "Models", icon: Boxes },
    { id: "providers", label: "Providers", icon: Route },
    { id: "audit-log", label: "Audit Log", icon: FileClock },
    { id: "dashboard", label: "Legacy Dashboard", icon: BookOpen },
    { id: "ops-console", label: "Ops Console", icon: TerminalSquare }
  ];

  return (
    <section className="mx-auto grid w-full max-w-5xl gap-5">
      <SectionCard title="Library" description="Existing Frank Hub pages remain available here." icon={<BookOpen aria-hidden="true" />}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.id}
                type="button"
                className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-surface px-4 text-left text-sm font-semibold text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onNavigate(entry.id)}
              >
                <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                {entry.label}
              </button>
            );
          })}
        </div>
      </SectionCard>
    </section>
  );
}
