// The hub: Frank's home, and the first thing the owner sees.
//
// Frank is the hub for every project the owner runs, so the root shows each
// project with its real setup state from `/api/projects` and, where a read
// model exists, what needs the owner from that project. For Blockwise that is
// the attention count from `/api/owner/workspace/sources`. Below the projects
// is the Hermes conversation list from `/api/chat/sessions`.
//
// A project card opens that project's home inside this shell. A chat opens the
// classic Frank window, because chats have not been converted yet, and the card
// says so rather than pretending otherwise.
import * as React from "react"
import { AlertCircle, ArrowUpRight, CheckCircle2, Clock3, MessageSquare, RefreshCw } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  CHAT_SESSIONS_URL,
  formatSince,
  SOURCES_URL,
  useEndpoint,
  type ChatSessionsResponse,
  type Endpoint,
  type ProjectSummary,
  type ProjectsResponse,
  type SourcesResponse,
} from "@/lib/api"
import { sourceSummary } from "@/lib/sources"
import type { Navigate } from "@/lib/targets"

const HUB_PATH = "/hub"
const MAX_CHATS = 6

const SETUP_WORD: Record<string, string> = {
  ready: "Ready",
  starting: "Starting",
  attention: "Needs attention",
}

/** Setup state is not a source status: "starting" is not "not connected". */
export function SetupBadge({ state }: { state: string }) {
  const word = SETUP_WORD[state] || "Unknown"
  const tone =
    state === "ready"
      ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
      : state === "attention"
        ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"
        : "bg-muted text-muted-foreground"
  const Icon = state === "ready" ? CheckCircle2 : state === "attention" ? AlertCircle : Clock3
  return (
    <Badge variant="outline" className={`gap-1 border-transparent font-medium ${tone}`}>
      <Icon className="size-3.5" aria-hidden="true" />
      {word}
    </Badge>
  )
}

function ProjectCard({ project, navigate, blockwise }: { project: ProjectSummary; navigate: Navigate; blockwise: { connected: number; total: number; attention: number; loaded: boolean } }) {
  return (
    <Card className="flex flex-col rounded-2xl">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <CardTitle className="text-base">{project.name || project.id}</CardTitle>
        <SetupBadge state={project.setup_state} />
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <p className="text-sm text-muted-foreground">{project.blurb || "Project workspace."}</p>
        <p className="text-sm" aria-live="polite">
          {project.id === "blockwise" ? (
            !blockwise.loaded ? (
              <span className="text-muted-foreground">Checking what needs you.</span>
            ) : blockwise.attention ? (
              <span className="font-medium">{blockwise.attention} item(s) need you</span>
            ) : (
              <span className="text-muted-foreground">Nothing is waiting on you</span>
            )
          ) : (
            <span className="text-muted-foreground">Frank reads no source for this project yet.</span>
          )}
        </p>
        {project.id === "blockwise" && blockwise.loaded ? (
          <p className="text-xs text-muted-foreground">
            {blockwise.connected} of {blockwise.total} sources connected
          </p>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-2">
          <Button
            variant="secondary"
            className="h-11 gap-1 rounded-xl lg:h-9"
            onClick={() => (project.id === "blockwise" ? navigate("overview") : navigate("project", { projectId: project.id }))}
          >
            Open {project.name || project.id}
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Button>
          <Button asChild variant="ghost" className="h-11 rounded-xl text-muted-foreground lg:h-9">
            <a href={`/project/${encodeURIComponent(project.id)}?technical=1`}>Technical view</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function Hub({ navigate, projects }: { navigate: Navigate; projects: Endpoint<ProjectsResponse> }) {
  const sources = useEndpoint<SourcesResponse>(SOURCES_URL, { refreshMs: 60000 })
  const chats = useEndpoint<ChatSessionsResponse>(CHAT_SESSIONS_URL, { refreshMs: 60000 })

  const summary = React.useMemo(() => sourceSummary(sources.data), [sources.data])
  const blockwise = {
    connected: summary.connected,
    total: summary.total,
    attention: summary.attention,
    loaded: sources.state === "ready" || Boolean(sources.data),
  }
  const list = projects.data?.projects || []
  const recent = React.useMemo(
    () => [...(chats.data?.sessions || [])].sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).slice(0, MAX_CHATS),
    [chats.data],
  )

  return (
    <div className="mx-auto w-full max-w-[1360px] px-4 py-6 md:px-8 md:py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Frank</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every project you run, and the conversations that work on them.
          </p>
        </div>
        <Button
          variant="outline"
          className="h-11 gap-2 rounded-xl"
          onClick={() => {
            projects.refresh()
            sources.refresh()
            chats.refresh()
          }}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      <section aria-labelledby="projects-heading">
        <h2 id="projects-heading" className="mb-3 text-lg font-semibold">
          Projects
        </h2>
        {projects.state === "loading" && !projects.data ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-44 w-full" />
            <Skeleton className="h-44 w-full" />
            <Skeleton className="h-44 w-full" />
          </div>
        ) : projects.error && !list.length ? (
          <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
            Frank could not read its project registry. {projects.error}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {list.map((project) => (
              <ProjectCard key={project.id} project={project} navigate={navigate} blockwise={blockwise} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10" aria-labelledby="chats-heading">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="chats-heading" className="text-lg font-semibold">
            Chats
          </h2>
          <a href={HUB_PATH} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            All chats and projects
          </a>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Conversations open in the classic Frank window until they are rebuilt here.
        </p>
        {chats.state === "loading" && !chats.data ? (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : recent.length ? (
          <ul className="divide-y rounded-2xl border">
            {recent.map((session) => (
              <li key={session.id}>
                <a href={HUB_PATH} className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50">
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{session.title || session.id}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[session.model, `${session.message_count} message(s)`, formatSince(session.updated_at)].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
            {chats.error ? `Frank could not read the conversation list. ${chats.error}` : "No conversations yet."}
          </p>
        )}
      </section>
    </div>
  )
}
