'use client';

/**
 * Bounded Graphify control surface.
 *
 * The canvas is fed only by GET /overview, which is API-bounded to 100 nodes
 * and 200 edges. Raw Graphify output is never requested by this client.
 */

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchGraphView,
  fetchProjects,
  pollGraphRefresh,
  requestGraphRefresh,
  type BoundedOverview,
  type CodegraphProject,
  type GraphJob,
  type GraphStatus,
  type RefreshPhase as PollRefreshPhase,
} from './graph-data';

const PipelineGraph = dynamic(
  () => import('@frank/pipeline-graph').then((module) => module.PipelineGraph),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full place-items-center font-mono text-xs text-muted" role="status">
        Loading graph renderer…
      </div>
    ),
  },
);

type ViewState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
type RefreshState = 'idle' | 'requesting' | PollRefreshPhase;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The graph request failed.';
}

function generatedLabel(value: string | null | undefined): string {
  if (!value) return 'Not reported';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date);
}

function refreshButtonLabel(state: RefreshState): string {
  if (state === 'requesting') return 'Requesting…';
  if (state === 'queued') return 'Refresh queued…';
  if (state === 'building') return 'Building…';
  return 'Refresh graph';
}

function statusLabel(
  status: GraphStatus | null,
  project: CodegraphProject | undefined,
  refresh: RefreshState,
): string {
  if (refresh === 'requesting') return 'requesting';
  if (refresh === 'queued') return 'queued';
  if (refresh === 'building') return 'building';
  if (status) return status.state;
  return project?.available ? 'loading' : 'not built';
}

export default function GraphConsolePage() {
  const [projects, setProjects] = useState<CodegraphProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<GraphStatus | null>(null);
  const [overview, setOverview] = useState<BoundedOverview | null>(null);
  const [viewState, setViewState] = useState<ViewState>('idle');
  const [viewError, setViewError] = useState<string | null>(null);
  const [refreshState, setRefreshState] = useState<RefreshState>('idle');
  const [refreshJob, setRefreshJob] = useState<
    Pick<GraphJob, 'job_id' | 'state' | 'requested_at'> | null
  >(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [projectsReload, setProjectsReload] = useState(0);
  const [snapshotReload, setSnapshotReload] = useState(0);
  const refreshAbortRef = useRef<AbortController | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedId),
    [projects, selectedId],
  );
  useEffect(() => {
    let cancelled = false;
    setProjectsLoading(true);
    setProjectsError(null);

    void fetchProjects()
      .then((nextProjects) => {
        if (cancelled) return;
        setProjects(nextProjects);
        setSelectedId((current) => {
          if (current && nextProjects.some((project) => project.id === current)) return current;
          return (
            nextProjects.find((project) => project.available)?.id ?? nextProjects[0]?.id ?? null
          );
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) setProjectsError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectsReload]);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    setOverview(null);
    setViewError(null);

    if (!selectedId) {
      setViewState('idle');
      return () => {
        cancelled = true;
      };
    }
    setViewState('loading');
    void fetchGraphView(selectedId)
      .then((view) => {
        if (cancelled) return;
        setStatus(view.status);
        setOverview(view.overview);
        setViewState(view.overview && view.overview.spec.nodes.length > 0 ? 'ready' : 'empty');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setViewError(errorMessage(error));
        setViewState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, snapshotReload]);

  useEffect(() => {
    refreshAbortRef.current?.abort();
    refreshAbortRef.current = null;
    setRefreshState('idle');
    setRefreshJob(null);
    setRefreshError(null);
    setAnnouncement('');
  }, [selectedId]);

  useEffect(
    () => () => {
      refreshAbortRef.current?.abort();
    },
    [],
  );

  async function refreshGraph() {
    if (!selectedId || !selectedProject || refreshState !== 'idle') return;

    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    setRefreshState('requesting');
    setRefreshError(null);
    setViewError(null);
    setAnnouncement('Requesting a Graphify rebuild.');

    try {
      const receipt = await requestGraphRefresh(selectedId);
      if (controller.signal.aborted) return;

      const receiptPhase: PollRefreshPhase = receipt.state === 'queued' ? 'queued' : 'building';
      setRefreshJob(receipt);
      setRefreshState(receiptPhase);
      setAnnouncement(
        receiptPhase === 'queued'
          ? 'Graphify accepted the refresh. The rebuild is queued.'
          : 'Graphify accepted the refresh. The rebuild is running.',
      );
      let lastPhase: PollRefreshPhase = receiptPhase;
      const snapshot = await pollGraphRefresh({
        projectId: selectedId,
        receipt,
        signal: controller.signal,
        onProgress: (phase, job) => {
          if (job) setRefreshJob(job);
          setRefreshState(phase);
          if (phase !== lastPhase) {
            setAnnouncement(
              phase === 'building'
                ? 'Graphify is building the graph.'
                : 'The graph refresh is queued.',
            );
            lastPhase = phase;
          }
        },
      });
      if (controller.signal.aborted) return;

      setStatus(snapshot.status);
      setOverview(snapshot.overview);
      setRefreshJob(snapshot.job);
      setViewState(snapshot.overview.spec.nodes.length > 0 ? 'ready' : 'empty');
      setProjects((current) =>
        current.map((project) =>
          project.id === selectedId
            ? { ...project, available: true, generated_at: snapshot.status.generated_at }
            : project,
        ),
      );
      setRefreshState('idle');
      setAnnouncement('Graphify rebuild completed. The bounded overview is up to date.');
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      setRefreshState('idle');
      setRefreshError(errorMessage(error));
      setAnnouncement('The graph refresh did not complete.');
    } finally {
      if (refreshAbortRef.current === controller) refreshAbortRef.current = null;
    }
  }

  const isRefreshing = refreshState !== 'idle';
  const isQueued = refreshState === 'queued' || status?.state === 'queued';
  const isBuilding = refreshState === 'building' || status?.state === 'building';
  const generatedAt = status?.generated_at ?? selectedProject?.generated_at ?? null;
  const displayedJob =
    refreshJob ?? status?.build.active_job ?? status?.build.recent_jobs[0] ?? null;
  const shownNodes = overview?.spec.nodes.length ?? 0;
  const shownEdges = overview?.spec.edges.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <h1 className="sr-only">Frank Graph Intelligence — Graphify console</h1>

      <div className="flex flex-wrap items-end gap-3 border-b border-line bg-rail/40 px-4 py-3">
        <div className="min-w-52">
          <label
            htmlFor="graph-project"
            className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-muted"
          >
            Project
          </label>
          <select
            id="graph-project"
            value={selectedId ?? ''}
            onChange={(event) => setSelectedId(event.target.value || null)}
            disabled={projectsLoading || projects.length === 0}
            className="h-9 w-full rounded-md border border-line bg-subtle px-2.5 font-mono text-xs text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {projects.length === 0 && (
              <option value="">{projectsLoading ? 'Loading projects…' : 'No projects'}</option>
            )}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} ({project.id}){project.available ? '' : ' — not built'}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => void refreshGraph()}
          disabled={!selectedId || isRefreshing || projectsLoading}
          aria-describedby="refresh-status"
          className="h-9 rounded-md border border-line bg-subtle px-3 font-mono text-[11px] font-medium uppercase tracking-wide text-ink2 transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {refreshButtonLabel(refreshState)}
        </button>

        <p className="ml-auto max-w-md text-right text-[11px] leading-relaxed text-muted">
          Bounded overview only · up to 100 nodes and 200 edges · raw graph data is never loaded
        </p>
      </div>

      <div className="border-b border-line bg-card px-4 py-2.5">
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-[11px]">
          <div>
            <dt className="font-mono uppercase tracking-wide text-muted">Backend</dt>
            <dd className="mt-0.5 font-medium text-ink">Graphify</dd>
          </div>
          <div>
            <dt className="font-mono uppercase tracking-wide text-muted">Status</dt>
            <dd className="mt-0.5 font-medium capitalize text-ink">
              {statusLabel(status, selectedProject, refreshState)}
            </dd>
          </div>
          <div>
            <dt className="font-mono uppercase tracking-wide text-muted">Generated</dt>
            <dd className="mt-0.5 text-ink">
              {generatedAt ? <time dateTime={generatedAt}>{generatedLabel(generatedAt)}</time> : 'Not reported'}
            </dd>
          </div>
          <div>
            <dt className="font-mono uppercase tracking-wide text-muted">Build job</dt>
            <dd className="mt-0.5 font-mono text-ink" title={displayedJob?.job_id}>
              {displayedJob
                ? `${displayedJob.job_id.slice(0, 8)} · ${displayedJob.state}`
                : 'None reported'}
            </dd>
          </div>
          <div>
            <dt className="font-mono uppercase tracking-wide text-muted">Bounded slice</dt>
            <dd className="mt-0.5 text-ink">
              {overview
                ? `${shownNodes} of ${overview.total_nodes} nodes · ${shownEdges} of ${overview.total_edges} edges`
                : 'Waiting for a graph'}
            </dd>
          </div>
          <div>
            <dt className="font-mono uppercase tracking-wide text-muted">Truncation</dt>
            <dd className={`mt-0.5 font-medium ${overview?.truncated ? 'text-warning' : 'text-ink'}`}>
              {overview ? (overview.truncated ? 'Truncated to render limit' : 'Not truncated') : 'Unknown'}
            </dd>
          </div>
        </dl>
      </div>

      <p id="refresh-status" className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {(refreshError || viewError) && (
        <div className="border-b border-red-300/40 bg-red-50 px-4 py-2.5 text-[12px] text-red-700" role="alert">
          {refreshError ?? viewError}
        </div>
      )}

      <main
        className="relative min-h-0 flex-1 overflow-hidden"
        aria-busy={projectsLoading || viewState === 'loading' || isRefreshing}
      >
        {isRefreshing && (
          <div
            className="absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full border border-accent/30 bg-card/95 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-accent shadow-sm"
            role="status"
          >
            {refreshState === 'building' ? 'Graphify is building' : 'Refresh queued'}
          </div>
        )}

        {projectsLoading && (
          <div className="grid h-full place-items-center" role="status">
            <p className="font-mono text-xs text-muted">Loading Graphify projects…</p>
          </div>
        )}

        {!projectsLoading && projectsError && (
          <div className="grid h-full place-items-center px-6 text-center">
            <div className="max-w-md">
              <h2 className="font-display text-base font-semibold text-ink">Projects unavailable</h2>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{projectsError}</p>
              <button
                type="button"
                onClick={() => setProjectsReload((value) => value + 1)}
                className="mt-4 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink2 hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                Retry project list
              </button>
            </div>
          </div>
        )}

        {!projectsLoading && !projectsError && projects.length === 0 && (
          <div className="grid h-full place-items-center px-6 text-center">
            <div className="max-w-md">
              <h2 className="font-display text-base font-semibold text-ink">No Graphify projects</h2>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                No project is registered with the graph backend yet.
              </p>
            </div>
          </div>
        )}

        {!projectsLoading && !projectsError && selectedProject && viewState === 'loading' && (
          <div className="grid h-full place-items-center" role="status">
            <p className="font-mono text-xs text-muted">Loading bounded overview…</p>
          </div>
        )}

        {!projectsLoading && !projectsError && selectedProject && viewState === 'error' && (
          <div className="grid h-full place-items-center px-6 text-center">
            <div className="max-w-md">
              <h2 className="font-display text-base font-semibold text-ink">Graph unavailable</h2>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                The bounded overview could not be loaded. No graph is shown in its place.
              </p>
              <button
                type="button"
                onClick={() => setSnapshotReload((value) => value + 1)}
                className="mt-4 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink2 hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                Retry bounded view
              </button>
            </div>
          </div>
        )}

        {!projectsLoading &&
          !projectsError &&
          selectedProject &&
          viewState === 'empty' && (
            <div className="grid h-full place-items-center px-6 text-center">
              <div className="max-w-md">
                <h2 className="font-display text-base font-semibold text-ink">
                  {isBuilding
                    ? 'Graphify is building this project'
                    : isQueued
                      ? 'Graph build queued'
                      : 'No graph generated yet'}
                </h2>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                  {isRefreshing
                    ? 'This view will update when the backend reports a completed build.'
                    : 'Queue a refresh to ask Graphify to build a bounded project overview.'}
                </p>
              </div>
            </div>
          )}

        {!projectsLoading &&
          !projectsError &&
          selectedProject &&
          viewState === 'ready' &&
          overview && (
            <section className="h-full" aria-label={`Bounded code graph for ${selectedProject.id}`}>
              {isBuilding && (
                <div className="absolute inset-x-0 top-0 z-10 border-b border-warning/30 bg-warning/10 px-4 py-2 text-center text-[11px] text-warning" role="status">
                  Graphify is rebuilding. The current bounded slice remains visible until a completed build is reported.
                </div>
              )}
              <PipelineGraph
                spec={overview.spec}
                inspector
                minimap={overview.spec.nodes.length > 12}
                className="h-full w-full"
              />
            </section>
          )}
      </main>
    </div>
  );
}
