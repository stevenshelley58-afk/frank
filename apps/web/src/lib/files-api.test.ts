import { describe, expect, it } from 'vitest';

import { fetchFiles } from './files-api';

/** Minimal ApiFetch stub: records the URL, answers with a canned body. */
function stubApi(body: unknown, urlLog: string[] = []) {
  return async (path: string): Promise<Response> => {
    urlLog.push(path);
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

describe('fetchFiles (W3-1 files browser client)', () => {
  it('requests the root listing when no path is given', async () => {
    const urlLog: string[] = [];
    const result = await fetchFiles(stubApi({ kind: 'dir', path: 'C:/Dev', entries: [], truncated: false }, urlLog));
    expect(urlLog).toEqual(['/v1/files']);
    expect(result.kind).toBe('dir');
  });

  it('encodes the path so separators and spaces survive the query string', async () => {
    const urlLog: string[] = [];
    await fetchFiles(stubApi({ kind: 'dir', path: 'C:/Dev/sub', entries: [], truncated: false }, urlLog), 'C:/Dev/sub');
    expect(urlLog).toEqual(['/v1/files?path=C%3A%2FDev%2Fsub']);
  });

  it('round-trips the server path verbatim for child listings', async () => {
    const serverPath = 'C:\\Dev\\frank\\apps';
    const urlLog: string[] = [];
    const result = await fetchFiles(stubApi({ kind: 'dir', path: serverPath, entries: [], truncated: false }, urlLog), serverPath);
    expect(urlLog).toEqual([`/v1/files?path=${encodeURIComponent(serverPath)}`]);
    expect(result.kind).toBe('dir');
    expect(result.path).toBe(serverPath);
  });

  it('surfaces file content responses unchanged', async () => {
    const body = { kind: 'file', path: 'C:/Dev/README.md', name: 'README.md', size: 4, content: '# hi\n' };
    const result = await fetchFiles(stubApi(body), 'C:/Dev/README.md');
    expect(result.kind).toBe('file');
    if (result.kind === 'file') {
      expect(result.content).toBe('# hi\n');
      expect(result.name).toBe('README.md');
    }
  });
});
