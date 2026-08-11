import { describe, expect, it } from 'vitest';
import { getFrame } from './frame';

describe('getFrame', () => {
  it('sends the cached ETag and preserves data on 304', async () => {
    const api = async (_path: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('if-none-match')).toBe('W/"frame"');
      return new Response(null, { status: 304, headers: { etag: 'W/"frame"' } });
    };
    await expect(getFrame(api, 'W/"frame"')).resolves.toEqual({ kind: 'not_modified', etag: 'W/"frame"' });
  });
});
