import type * as React from "react";
import { BookOpen, Bot, Boxes, FileClock, Folder, ListTodo, MessageCircle, Plus, Rocket, Route, ShieldCheck, TerminalSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { createProject, listProjects, type Project } from "../api.js";
import { Button, Input } from "../components/ui/index.js";
import { DataTable, EmptyState, LoadingBlock, ResourceError, SectionCard, StatusBadge } from "../components/dashboard/index.js";
import { formatDateTime, titleize } from "../lib/format.js";

type ProjectsState =
  | { status: "loading" }
  | { status: "ready"; projects: Project[] }
  | { status: "error"; message: string };

export function ProjectsPage() {
  const [state, setState] = useState<ProjectsState>({ status: "loading" });
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [repoRemote, setRepoRemote] = useState("");

  const load = () => {
    const controller = new AbortController();
    setState({ status: "loading" });
    listProjects({ signal: controller.signal })
      .then((projects) => setState({ status: "ready", projects }))
      .catch((error) => {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
    return controller;
  };

  useEffect(() => {
    const controller = load();
    return () => controller.abort();
  }, []);

  async function submitProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!displayName.trim() || !slug.trim()) {
      return;
    }
    await createProject({
      displayName: displayName.trim(),
      slug: slug.trim(),
      repoRemote: repoRemote.trim() || null
    });
    setDisplayName("");
    setSlug("");
    setRepoRemote("");
    load();
  }

  if (state.status === "loading") {
    return <LoadingBlock rows={6} />;
  }

  if (state.status === "error") {
    return <ResourceError message={state.message} onRetry={() => load()} />;
  }

  return (
    <section className="grid gap-5">
      <SectionCard title="Add Project" description="Register VPS project workspaces under the operator allowlist." icon={<Plus aria-hidden="true" />}>
        <form className="grid gap-3 md:grid-cols-[1fr_14rem_1fr_auto]" onSubmit={submitProject}>
          <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Display name" />
          <Input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="slug" />
          <Input value={repoRemote} onChange={(event) => setRepoRemote(event.target.value)} placeholder="Git remote" />
          <Button type="submit">
            <Plus aria-hidden="true" />
            Add
          </Button>
        </form>
      </SectionCard>

      <SectionCard title="Projects" description="Registered workspaces for Frank and Hermes." icon={<Folder aria-hidden="true" />}>
        <DataTable
          data={state.projects}
          getRowId={(project) => project.id}
          emptyState={<EmptyState icon={<Folder aria-hidden="true" />} title="No projects" description="Add a project workspace above." />}
          columns={[
            { id: "name", header: "Project", cell: (project) => <span className="font-semibold text-foreground">{project.displayName}</span> },
            { id: "status", header: "Status", cell: (project) => <StatusBadge tone={project.status === "active" ? "healthy" : "planned"}>{titleize(project.status)}</StatusBadge> },
            { id: "workspace", header: "Workspace", cell: (project) => <span className="text-muted-foreground">{project.workspacePath}</span> },
            { id: "remote", header: "Remote", cell: (project) => <span className="text-muted-foreground">{project.repoRemote ?? "None"}</span> },
            { id: "updated", header: "Updated", cell: (project) => <span className="text-muted-foreground">{formatDateTime(project.updatedAt)}</span> }
          ]}
        />
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load projects.";
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
    { id: "self-upgrades", label: "Self-Upgrades", icon: Rocket },
    { id: "messaging", label: "Messaging", icon: MessageCircle },
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
