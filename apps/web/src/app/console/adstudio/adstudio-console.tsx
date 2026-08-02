'use client';

import '@frank/pipeline-graph/src/pipeline-graph.css';
import type { KeyboardEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';

import { PipelineGraph } from '@frank/pipeline-graph';

import { AdAnatomy } from './AdAnatomy';
import { DEMO_TEMPLATES, type DemoTemplate } from './templates-data';
import { buildTemplateTraceSpec } from './trace-spec';

/**
 * AdStudio console landing view: the template lifecycle GRAPH.
 *
 * This is the approved modular pipeline visualiser (frank-pipeline-graph):
 * a real template traced end-to-end — source ad → clone request → sample
 * QA → OCR v2 measurement → template contract → customer generation →
 * region mapping → targeted edits. Click any node to drill down in the
 * inspector; the anatomy region-editor lives one drill-down away via the
 * "Inspect regions →" action on the sample and finished-creative nodes.
 */

const MONO = "'JetBrains Mono', 'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const TABS = [
  { key: 'graph', label: 'Pipeline graph', hint: 'the lifecycle, end to end' },
  { key: 'anatomy', label: 'Template anatomy', hint: 'regions on the real canvas' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function AdStudioConsole() {
  const [tab, setTab] = useState<TabKey>('graph');
  const [templateId, setTemplateId] = useState<string>(DEMO_TEMPLATES[0].id);

  const template: DemoTemplate =
    DEMO_TEMPLATES.find((t) => t.id === templateId) ?? DEMO_TEMPLATES[0];

  useEffect(() => {
    if (tab === 'anatomy' || templateId !== DEMO_TEMPLATES[0].id) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'a' || e.key === 'A') setTab('anatomy');
      if (e.key === 'g' || e.key === 'G') setTab('graph');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, templateId]);

  const gotoTemplate = useCallback((id: string) => {
    setTemplateId(id);
    setTab('anatomy');
  }, []);

  const cycleTemplate = useCallback(
    (dir: 1 | -1) => {
      setTemplateId((cur) => {
        const idx = DEMO_TEMPLATES.findIndex((t) => t.id === cur);
        const next = (idx + dir + DEMO_TEMPLATES.length) % DEMO_TEMPLATES.length;
        return DEMO_TEMPLATES[next].id;
      });
    },
    [],
  );

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, key: TabKey) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setTab(key);
    }
  };

  return (
    <div className="adstudio-shell">
      <style>{adStudioShellCss}</style>

      {/* ---------- header: template context + view switcher ---------- */}
      <header className="adstudio-top">
        <div className="adstudio-template">
          <div className="adstudio-template-meta">
            <span className="adstudio-template-index">
              {String(DEMO_TEMPLATES.findIndex((t) => t.id === template.id) + 1).padStart(2, '0')}
              <span className="adstudio-template-total">/{String(DEMO_TEMPLATES.length).padStart(2, '0')}</span>
            </span>
            <button
              type="button"
              className="adstudio-cycler"
              aria-label="Previous template"
              onClick={() => cycleTemplate(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              className="adstudio-cycler"
              aria-label="Next template"
              onClick={() => cycleTemplate(1)}
            >
              ›
            </button>
          </div>
          <div className="adstudio-template-name" title={template.name}>
            {template.name}
          </div>
          <div className="adstudio-template-tags">
            <span className="adstudio-tag">{template.format}</span>
            <span className="adstudio-tag">
              {template.dimensions.width}×{template.dimensions.height}
            </span>
            <span className="adstudio-tag">{template.textInputs.length} text</span>
            <span className="adstudio-tag">{template.imageInputs.length} img</span>
            <span
              className={`adstudio-tag adstudio-tag-status adstudio-status-${template.deterministicStatus}`}
              title="Box readiness for deterministic region editing"
            >
              boxes: {template.deterministicStatus}
            </span>
          </div>
        </div>

        <nav className="adstudio-tabs" role="tablist" aria-label="AdStudio views">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`adstudio-tab ${tab === t.key ? 'is-active' : ''}`}
              onClick={() => setTab(t.key)}
              onKeyDown={(e) => onTabKeyDown(e, t.key)}
            >
              <span className="adstudio-tab-label">{t.label}</span>
              <span className="adstudio-tab-hint">{t.hint}</span>
            </button>
          ))}
        </nav>
      </header>

      {/* ---------- body ---------- */}
      {tab === 'graph' ? (
        <div className="adstudio-graph-wrap">
          <div className="adstudio-hints" aria-hidden="true">
            <span><b>drag</b> pan</span>
            <span><b>scroll</b> zoom</span>
            <span><b>click node</b> drill down</span>
            <span className="adstudio-hint-key"><b>G</b> graph</span>
            <span className="adstudio-hint-key"><b>A</b> anatomy</span>
          </div>
          <PipelineGraph
            spec={buildTemplateTraceSpec(template)}
            onAction={(_nodeId, actionKey) => {
              if (actionKey === 'open-anatomy') gotoTemplate(template.id);
            }}
            className="adstudio-pg"
          />
        </div>
      ) : (
        <div className="adstudio-anatomy-wrap">
          <AdAnatomy initialTemplateId={template.id} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shell styles — scoped to .adstudio-shell so they never leak.        */
/* Palette follows the console: warm off-white shell, ink type, one    */
/* amber accent carried through from the pipeline-graph nodes.         */
/* ------------------------------------------------------------------ */
const adStudioShellCss = `
.adstudio-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #f5f1e8;
  color: #26211a;
}

/* ---- header ---- */
.adstudio-top {
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 20px;
  padding: 10px 18px 0;
  border-bottom: 1px solid #e3dccb;
  background: linear-gradient(180deg, #faf7f0 0%, #f5f1e8 100%);
}
.adstudio-template {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 10px;
}
.adstudio-template-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}
.adstudio-template-index {
  font-family: ${MONO};
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: #8d8270;
}
.adstudio-template-total { opacity: 0.55; }
.adstudio-cycler {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid #d8d0bd;
  border-radius: 5px;
  background: #fffdf8;
  color: #6b6252;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease, transform 90ms ease;
}
.adstudio-cycler:hover { border-color: #b3a88f; color: #26211a; }
.adstudio-cycler:active { transform: scale(0.92); }
.adstudio-template-name {
  font-family: 'Space Grotesk', 'Inter', system-ui, sans-serif;
  font-size: 19px;
  font-weight: 650;
  letter-spacing: -0.01em;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 420px;
}
.adstudio-template-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.adstudio-tag {
  font-family: ${MONO};
  font-size: 9.5px;
  letter-spacing: 0.06em;
  padding: 2px 7px;
  border: 1px solid #ddd5c2;
  border-radius: 999px;
  background: #fffdf8;
  color: #6b6252;
  white-space: nowrap;
}
.adstudio-tag-status { font-weight: 600; }
.adstudio-status-ready { color: #2f7a4d; border-color: #b9d6c2; background: #eef7f0; }
.adstudio-status-partial { color: #a06a12; border-color: #e3c98f; background: #fbf3e0; }
.adstudio-status-none { color: #a34434; border-color: #e0b3a8; background: #faf0ec; }

/* ---- view switcher ---- */
.adstudio-tabs {
  display: flex;
  gap: 4px;
  align-items: flex-end;
  flex-shrink: 0;
}
.adstudio-tab {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 8px 14px 9px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease;
}
.adstudio-tab:hover { background: rgba(38, 33, 26, 0.04); }
.adstudio-tab.is-active { border-bottom-color: #c98a2d; }
.adstudio-tab-label {
  font-family: 'Space Grotesk', 'Inter', system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: #8d8270;
  transition: color 140ms ease;
}
.adstudio-tab.is-active .adstudio-tab-label { color: #26211a; }
.adstudio-tab-hint {
  font-size: 10px;
  letter-spacing: 0.04em;
  color: #a99e88;
}
.adstudio-tab.is-active .adstudio-tab-hint { color: #8d8270; }

/* ---- graph body ---- */
.adstudio-graph-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.adstudio-hints {
  position: absolute;
  top: 8px;
  left: 14px;
  z-index: 6;
  display: flex;
  gap: 12px;
  font-size: 10.5px;
  letter-spacing: 0.05em;
  color: #a99e88;
  pointer-events: none;
}
.adstudio-hints b {
  font-family: ${MONO};
  font-weight: 600;
  color: #6b6252;
  background: #fffdf8;
  border: 1px solid #e3dccb;
  border-radius: 4px;
  padding: 1px 5px;
  margin-right: 3px;
}
.adstudio-hint-key { opacity: 0.85; }
.adstudio-pg { flex: 1; min-height: 0; }

/* ---- anatomy body ---- */
.adstudio-anatomy-wrap { flex: 1; min-height: 0; display: flex; }
.adstudio-anatomy-wrap > * { flex: 1; min-height: 0; }
`;
