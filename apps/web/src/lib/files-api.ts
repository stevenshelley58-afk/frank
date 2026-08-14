import type { ApiFetch, Identifiers } from './api';

/** One row of a directory listing (W3-1 `/v1/files`). */
export interface FilesEntry {
  name: string;
  kind: 'file' | 'dir';
  size: number;
}

export interface FilesListing {
  kind: 'dir';
  /** Resolved absolute path — re-send verbatim as `?path=` for children. */
  path: string;
  entries: FilesEntry[];
  truncated: boolean;
  identifiers: Identifiers;
}

export interface FilesFile {
  kind: 'file';
  path: string;
  name: string;
  size: number;
  content: string;
  identifiers: Identifiers;
}

export type FilesResponse = FilesListing | FilesFile;

/**
 * Browse the projects root (W3-1). One endpoint answers both questions the
 * page asks: "what is in this directory?" (omit `path` or pass a directory)
 * and "what does this file contain?" (pass a file). The server resolves
 * `path` against FRANK_FILES_ROOT and refuses anything that escapes it.
 */
export async function fetchFiles(api: ApiFetch, path?: string): Promise<FilesResponse> {
  const query = path === undefined ? '' : `?path=${encodeURIComponent(path)}`;
  const response = await api(`/v1/files${query}`, { cache: 'no-store' });
  return (await response.json()) as FilesResponse;
}
