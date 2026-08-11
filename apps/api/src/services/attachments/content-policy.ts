/** Bounded, byte-signature policy; archive parsing belongs in the worker adapter. */
export type ContentVerdict = { allowed: true; mediaType: string } | { allowed: false; reason: 'mime_spoof' | 'executable' | 'encrypted_archive' | 'archive_bomb' | 'unsafe_archive_path' };
export function classifyContent(prefix: Uint8Array, declared: string | undefined, archive?: { encrypted: boolean; expandedBytes: bigint; paths: readonly string[] }): ContentVerdict {
  const executable = prefix.length >= 2 && prefix[0] === 0x4d && prefix[1] === 0x5a;
  if (executable) return { allowed: false, reason: 'executable' };
  const pdf = prefix.length >= 5 && new TextDecoder().decode(prefix.slice(0, 5)) === '%PDF-';
  const mediaType = pdf ? 'application/pdf' : 'application/octet-stream';
  if (declared && declared !== mediaType && declared !== 'application/octet-stream') return { allowed: false, reason: 'mime_spoof' };
  if (archive) { if (archive.encrypted) return { allowed: false, reason: 'encrypted_archive' }; if (archive.expandedBytes > 2n * 1024n * 1024n * 1024n) return { allowed: false, reason: 'archive_bomb' }; if (archive.paths.some(path => path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '..'))) return { allowed: false, reason: 'unsafe_archive_path' }; }
  return { allowed: true, mediaType };
}
