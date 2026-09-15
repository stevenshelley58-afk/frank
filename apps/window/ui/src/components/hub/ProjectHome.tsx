// One project's home in the shell.
//
// Frank is the hub for every project, so every project gets an address here.
// Blockwise has sections of its own and does not use this screen. Every other
// project gets the same facts the classic project home shows, from the same
// registry: name, blurb, setup state, its workspace, and its public address
// where it has one. Frank reads no source for these projects yet, so the screen
// says that and links to the classic project home rather than inventing signal.
import { ArrowLeft, ArrowUpRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { SetupBadge } from "@/components/hub/Hub"
import type { Endpoint, ProjectsResponse } from "@/lib/api"
import type { Navigate } from "@/lib/targets"

export function ProjectHome({ projectId, navigate, projects }: { projectId: string; navigate: Navigate; projects: Endpoint<ProjectsResponse> }) {
  const project = (projects.data?.projects || []).find((item) => item.id === projectId) || null
  const loading = projects.state === "loading" && !projects.data

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6 md:px-8 md:py-8">
      <Button variant="ghost" className="mb-4 h-11 gap-2 rounded-xl text-muted-foreground lg:h-9" onClick={() => navigate("hub")}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        Frank
      </Button>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : !project ? (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base">No project registered as “{projectId}”</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {projects.error || "Frank's project registry does not list this identifier, so there is nothing to show for it."}
            </p>
            <Button variant="secondary" className="h-11 rounded-xl lg:h-9" onClick={() => navigate("hub")}>
              Back to the hub
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{project.name || project.id}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{project.blurb || "Project workspace."}</p>
            </div>
            <SetupBadge state={project.setup_state} />
          </div>

          <Card className="rounded-2xl">
            <CardContent className="space-y-4 pt-6">
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Workspace</dt>
                  <dd className="text-sm">{project.workspace || "Not declared"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Memory scope</dt>
                  <dd className="text-sm">{project.memory_scope || "Not declared"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Public address</dt>
                  <dd className="text-sm">
                    {project.live ? (
                      <a href={project.live} className="underline-offset-4 hover:underline">
                        {project.live}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Hermes profile</dt>
                  <dd className="text-sm">{project.hermes_profile || "default"}</dd>
                </div>
              </dl>
              <p className="max-w-prose text-sm text-muted-foreground">
                Frank reads no source for this project yet, so this screen shows the registry facts only. Its home, files,
                activity and connections are in the classic Frank window.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="secondary" className="h-11 gap-1 rounded-xl lg:h-9">
                  <a href={`/project/${encodeURIComponent(project.id)}?technical=1`}>
                    Open the classic project home
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </a>
                </Button>
                <Button asChild variant="ghost" className="h-11 rounded-xl text-muted-foreground lg:h-9">
                  <a href="/hub">Chats and projects</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
