'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/components/providers';
import { Markdown } from '@/components/markdown';
import { getSkill, listSkills, type SkillDetail, type SkillSummary } from '@/lib/skills-api';

/**
 * /skills client host (W3-2). Lists every skill the running Hermes can see —
 * name + frontmatter description — and renders the selected skill's SKILL.md
 * with react-markdown. Read-only: nothing here writes to the library.
 *
 * The selection lives in the URL (`?skill=<relative path>`) so a skill page is
 * shareable and survives reload; multi-segment paths are encoded.
 */
export function SkillsPageClient() {
  const { api, status } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const selectedPath = searchParams.get('skill');

  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [filter, setFilter] = useState('');

  const loadList = useCallback(async () => {
    if (!api) return;
    setListError(null);
    try {
      const result = await listSkills(api);
      setSkills(result.skills);
      setTotal(result.total);
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Could not load the skill library.');
    }
  }, [api]);

  useEffect(() => {
    if (status !== 'ready') return;
    void loadList();
  }, [status, loadList]);

  useEffect(() => {
    if (!api || selectedPath === null) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    getSkill(api, selectedPath)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetail(null);
          setDetailError(error instanceof Error ? error.message : 'Could not load this skill.');
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, selectedPath]);

  const openSkill = useCallback(
    (path: string) => {
      router.replace(`/skills?skill=${encodeURIComponent(path)}`);
    },
    [router],
  );

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle.length === 0) return skills;
    return skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(needle) ||
        skill.description.toLowerCase().includes(needle) ||
        skill.path.toLowerCase().includes(needle),
    );
  }, [skills, filter]);

  if (status !== 'ready') {
    return (
      <div className="flex h-dvh items-center justify-center bg-shell">
        <span className="grid h-[46px] w-[46px] place-items-center rounded-xl bg-ink text-[24px] font-bold text-shell">
          F
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-shell">
      <header className="flex h-[54px] shrink-0 items-center gap-2.5 border-b border-line px-4">
        <b className="min-w-0 truncate text-[14px]">Skills</b>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted/80">
          · {total} skills in the Hermes library
        </span>
        <span className="flex-1" />
        <div className="relative hidden sm:block">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted/70"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.4-3.4" />
          </svg>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter skills…"
            className="h-[32px] w-[220px] rounded-[9px] border border-line bg-shell pl-8 pr-2.5 text-[12.5px] text-ink outline-none transition-colors placeholder:text-muted/70 focus:border-accent"
          />
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {listError ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="max-w-[420px] rounded-xl border border-line bg-card px-4 py-3">
              <p className="text-[12.5px] font-semibold text-ink">The skill library could not be read</p>
              <p className="mt-1 text-[12px] leading-snug text-ink2">{listError}</p>
              <button
                onClick={() => void loadList()}
                className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white transition-[filter] hover:brightness-105"
              >
                Retry
              </button>
            </div>
          </div>
        ) : (
          <div className="grid h-full grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
            {/* list */}
            <aside className="min-h-0 overflow-y-auto border-r border-line px-3 py-3">
              {visible.length === 0 ? (
                <p className="px-2 py-4 text-[12px] text-muted/80">
                  {skills.length === 0 ? 'No skills found.' : 'No skills match the filter.'}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {visible.map((skill) => (
                    <li key={skill.id}>
                      <button
                        onClick={() => openSkill(skill.path)}
                        className={`flex w-full items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors ${
                          selectedPath === skill.path
                            ? 'border-accent/40 bg-hover'
                            : 'border-transparent hover:bg-hover'
                        }`}
                      >
                        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-[3px] bg-accent/60" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <b className="truncate text-[12.5px] text-ink">{skill.name}</b>
                            {skill.frontmatter_error !== null && (
                              <span className="shrink-0 rounded-md bg-amber-500/15 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-amber-600">
                                broken
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-[11.5px] text-ink2">
                            {skill.description || 'No description.'}
                          </span>
                          <span className="mt-1 block truncate font-mono text-[9.5px] text-muted/70">
                            {skill.path}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>

            {/* detail */}
            <section className="min-h-0 overflow-y-auto px-5 py-4">
              {detailLoading ? (
                <p className="py-8 text-center text-[12px] text-muted/80">Loading skill…</p>
              ) : detailError ? (
                <div className="mx-auto mt-8 max-w-[520px] rounded-xl border border-line bg-card px-4 py-3">
                  <p className="text-[12.5px] font-semibold text-ink">This skill could not be opened</p>
                  <p className="mt-1 text-[12px] leading-snug text-ink2">{detailError}</p>
                  <p className="mt-2 font-mono text-[10px] text-muted/70">{selectedPath ?? ''}</p>
                </div>
              ) : detail ? (
                <article className="mx-auto max-w-[720px]">
                  <div className="mb-4 border-b border-line pb-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-[17px] font-bold text-ink">{detail.name}</h1>
                      {detail.frontmatter_error !== null && (
                        <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
                          frontmatter error
                        </span>
                      )}
                    </div>
                    {detail.description && (
                      <p className="mt-1.5 max-w-[560px] text-[12.5px] leading-snug text-ink2">
                        {detail.description}
                      </p>
                    )}
                    <p className="mt-2 font-mono text-[10px] text-muted/70">{detail.path}</p>
                  </div>

                  {detail.frontmatter_error !== null && (
                    <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                      <p className="text-[11.5px] font-semibold text-amber-700">
                        This skill&apos;s frontmatter could not be parsed — showing the raw file.
                      </p>
                      <p className="mt-1 break-words font-mono text-[10.5px] text-amber-700/80">
                        {detail.frontmatter_error}
                      </p>
                    </div>
                  )}

                  {detail.content.length === 0 ? (
                    <p className="py-6 text-[12.5px] text-muted/80">This skill has no content yet.</p>
                  ) : (
                    <Markdown text={detail.content} />
                  )}
                </article>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="max-w-[360px] text-center text-[12.5px] leading-relaxed text-muted/80">
                    Select a skill to read its rendered markdown.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
