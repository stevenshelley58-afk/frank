/**
 * FS-05 — artifact preview backend.
 *
 * Classifies registered artifacts and auto-deploys the viewable ones (HTML,
 * mockups) to the existing preview lane (master plan §8G FS-05), writing the
 * resulting preview URL back onto the `workbench_artifact` row so the receipt
 * and the room UI can surface a working link.
 *
 * ## The preview lane is infrastructure, not this service
 *
 * Deployment goes through a {@link PreviewDeployer} port. The production
 * deployer shells out to the VPS script `/srv/frank/infra/preview-deploy.sh`
 * over `ssh vps`; the script rsyncs a directory (or copies a single `.html`
 * as `index.html`) under `/srv/frank/static/preview/<slug>/` and prints the
 * live URL `https://preview.frank.fail/<slug>/`. Tests inject
 * {@link FakePreviewDeployer} — never the real ssh path.
 *
 * ## Source-path contract
 *
 * {@link SshPreviewDeployer} passes `sourcePath` to the script running ON THE
 * VPS, so the path must already exist there (the staged-write sync, FS-03, is
 * what puts artifact bytes on the VPS). For local development,
 * {@link LocalPreviewDeployer} copies a local source into a local preview
 * root instead — dev-only, no Caddy guarantees.
 */

import { execFile } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { basename, extname, isAbsolute, join } from 'node:path';

import type { WorkbenchStore } from './store.js';
import type { ArtifactDetail } from './types.js';

/* -------------------------------------------------------------- classify --- */

/**
 * Coarse artifact classification driving preview behaviour:
 *  - `html` / `mockup` — viewable: auto-deployable to the preview lane;
 *  - `report` — a deployable document, but not auto-published by FS-05
 *    (a report's preview is the receipt's business, not the file's);
 *  - `other` — not viewable, never auto-deployed.
 */
export type ArtifactClass = 'html' | 'mockup' | 'report' | 'other';

const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const MOCKUP_EXTENSIONS = new Set(['.svg']);
const REPORT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.pdf',
  '.txt',
  '.csv',
  '.json',
  '.xlsx',
  '.docx',
]);

/** Classify an artifact from its path and (optional) media type. */
export function classifyArtifact(path: string, mediaType?: string): ArtifactClass {
  const normalizedType = mediaType?.toLowerCase().trim();
  if (normalizedType === 'text/html') return 'html';
  if (normalizedType === 'image/svg+xml') return 'mockup';

  const extension = extname(path).toLowerCase();
  if (HTML_EXTENSIONS.has(extension)) return 'html';
  if (MOCKUP_EXTENSIONS.has(extension)) return 'mockup';
  if (REPORT_EXTENSIONS.has(extension)) return 'report';
  if (normalizedType !== undefined && (normalizedType.startsWith('text/') || normalizedType === 'application/pdf')) {
    return 'report';
  }
  return 'other';
}

/** Viewable artifacts are auto-deployable to the preview lane. */
export function isViewable(artifactClass: ArtifactClass): boolean {
  return artifactClass === 'html' || artifactClass === 'mockup';
}

/* ------------------------------------------------------------- sanitizer --- */

/** preview-deploy.sh topics must fit `[a-z0-9-]`; enforce it before ssh. */
export function sanitizeTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
    .replace(/^-|-$/g, '') || 'artifact';
}

/* -------------------------------------------------------------- deployer --- */

export interface PreviewDeployInput {
  readonly topic: string;
  readonly sourcePath: string;
  readonly mode?: 'new' | 'update' | 'exact';
}

export interface PreviewDeployResult {
  readonly url: string;
  readonly slug: string;
}

/** Port between the preview backend and a preview lane. */
export interface PreviewDeployer {
  deploy(input: PreviewDeployInput): Promise<PreviewDeployResult>;
}

/** Single-quote a token for the remote shell (the script runs under bash). */
function remoteShellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function modeArgument(mode: PreviewDeployInput['mode']): string | null {
  if (mode === undefined) return null;
  if (mode === 'new') return 'new';
  if (mode === 'update') return '--update';
  return '--exact';
}

/**
 * Production deployer: runs the existing preview lane script over `ssh vps`.
 *
 * `sourcePath` is interpreted on the VPS — it must exist there before this
 * deployer is called (FS-03 staged-write sync is the producer). This class
 * never touches local files.
 */
export class SshPreviewDeployer implements PreviewDeployer {
  readonly #host: string;
  readonly #scriptPath: string;
  readonly #timeoutMs: number;

  constructor(options?: { readonly host?: string; readonly scriptPath?: string; readonly timeoutMs?: number }) {
    this.#host = options?.host ?? 'vps';
    this.#scriptPath = options?.scriptPath ?? '/srv/frank/infra/preview-deploy.sh';
    this.#timeoutMs = options?.timeoutMs ?? 120_000;
  }

  async deploy(input: PreviewDeployInput): Promise<PreviewDeployResult> {
    const mode = modeArgument(input.mode);
    const remoteCommand = [
      this.#scriptPath,
      remoteShellQuote(sanitizeTopic(input.topic)),
      remoteShellQuote(input.sourcePath),
      ...(mode === null ? [] : [mode]),
    ].join(' ');

    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        'ssh',
        [this.#host, remoteCommand],
        { timeout: this.#timeoutMs, maxBuffer: 1_048_576, windowsHide: true },
        (error, out, err) => {
          if (error !== null) {
            reject(new Error(`preview deploy failed: ${error.message}${err ? ` — ${err.trim()}` : ''}`));
            return;
          }
          resolve(out);
        },
      );
    });

    // The script prints the live URL on success; take the first https token.
    const match = stdout.match(/https:\/\/[^\s'"]+/);
    if (match === null) {
      throw new Error(`preview-deploy.sh printed no preview URL (output: ${stdout.trim().slice(0, 200)})`);
    }
    const url = match[0];
    const slug = url.replace(/^https?:\/\/[^/]+\/?/, '').split('/').filter(Boolean)[0] ?? '';
    if (slug === '') {
      throw new Error(`preview-deploy.sh URL has no slug: ${url}`);
    }
    return { url, slug };
  }
}

/**
 * Dev-only deployer: copies a local source file into a local preview root
 * (a single file lands as `index.html`, mirroring the VPS script). Returns a
 * `file://` URL — there is no local preview Caddy, and FS-05 does not add one.
 */
export class LocalPreviewDeployer implements PreviewDeployer {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async deploy(input: PreviewDeployInput): Promise<PreviewDeployResult> {
    if (!isAbsolute(input.sourcePath)) {
      throw new Error(`LocalPreviewDeployer needs an absolute source path, got ${input.sourcePath}`);
    }
    const slug = sanitizeTopic(input.topic);
    const targetDir = join(this.#root, slug);
    await mkdir(targetDir, { recursive: true });
    const targetFile = join(targetDir, 'index.html');
    await copyFile(input.sourcePath, targetFile);
    return { url: `file://${targetFile}`, slug };
  }
}

/**
 * Deterministic deployer for tests — records every call and returns a stable
 * `https://preview.frank.fail/<slug>/` URL derived from the topic. Never ssh.
 */
export class FakePreviewDeployer implements PreviewDeployer {
  readonly calls: PreviewDeployInput[] = [];
  readonly #root: string;

  constructor(root = 'https://preview.frank.fail') {
    this.#root = root.replace(/\/$/, '');
  }

  async deploy(input: PreviewDeployInput): Promise<PreviewDeployResult> {
    this.calls.push(input);
    const slug = `${sanitizeTopic(input.topic)}-v1`;
    return { url: `${this.#root}/${slug}/`, slug };
  }
}

/* --------------------------------------------------------------- backend --- */

export interface PublishArtifactResult {
  /** The preview URL, or null when the artifact is not viewable. */
  readonly previewUrl: string | null;
  readonly classification: ArtifactClass;
  readonly slug: string | null;
}

export interface PreviewBackendOptions {
  readonly store: WorkbenchStore;
  readonly deployer: PreviewDeployer;
}

/**
 * FS-05's orchestration: classify → (viewable?) → deploy → write the preview
 * URL back to the artifact row → leave a durable event. Non-viewable
 * artifacts short-circuit with `previewUrl: null` and no deploy call.
 */
export class PreviewBackend {
  readonly #store: WorkbenchStore;
  readonly #deployer: PreviewDeployer;

  constructor(options: PreviewBackendOptions) {
    this.#store = options.store;
    this.#deployer = options.deployer;
  }

  /** Topic for the preview lane: file stem + workbench prefix, sanitized. */
  topicFor(workbenchId: string, artifactPath: string): string {
    const stem = basename(artifactPath).replace(/\.[^.]+$/, '') || 'artifact';
    return sanitizeTopic(`wb-${workbenchId.slice(0, 8)}-${stem}`);
  }

  async publishArtifact(
    workbenchId: string,
    artifact: ArtifactDetail,
    now: Date,
  ): Promise<PublishArtifactResult> {
    const classification = classifyArtifact(artifact.path, artifact.mediaType ?? undefined);
    if (!isViewable(classification)) {
      return { previewUrl: null, classification, slug: null };
    }

    const topic = this.topicFor(workbenchId, artifact.path);
    const { url, slug } = await this.#deployer.deploy({
      topic,
      sourcePath: artifact.path,
      mode: 'update',
    });

    // Upsert on (workbench_id, path): updates kind + preview_url, preserves
    // sha256/media_type (the conflict clause only touches kind/preview_url).
    await this.#store.registerArtifact(
      workbenchId,
      {
        id: artifact.id,
        path: artifact.path,
        kind: artifact.kind,
        previewUrl: url,
        ...(artifact.sha256 === null ? {} : { sha256: artifact.sha256 }),
        ...(artifact.mediaType === null ? {} : { mediaType: artifact.mediaType }),
      },
      now,
    );
    // Fixed event vocabulary (migration 0004): reuse artifact_registered and
    // carry the publish intent in the free-form payload.
    await this.#store.appendEvent(
      workbenchId,
      'artifact_registered',
      { action: 'preview_published', path: artifact.path, previewUrl: url, slug },
      now,
    );

    return { previewUrl: url, classification, slug };
  }
}
