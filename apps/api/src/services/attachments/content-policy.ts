/** Pure fail-closed policy used by the bounded sandbox adapter. */
export type ContentVerdict = { allowed: true; mediaType: string } | { allowed: false; reason: 'mime_spoof' | 'executable' | 'encrypted_archive' | 'archive_bomb' | 'unsafe_archive_path' | 'unsupported_archive' };
export function classifyContent(prefix: Uint8Array, declared: string | undefined, archive?: { encrypted: boolean; expandedBytes: bigint; paths: readonly string[]; supported: boolean }): ContentVerdict {
  const executable = (prefix[0] === 0x4d && prefix[1] === 0x5a) || (prefix[0] === 0x7f && prefix[1] === 0x45 && prefix[2] === 0x4c && prefix[3] === 0x46) || (prefix[0] === 0x23 && prefix[1] === 0x21);
  if (executable) return { allowed: false, reason: 'executable' };
  const pdf = new TextDecoder().decode(prefix.slice(0, 5)) === '%PDF-'; const zip = prefix[0] === 0x50 && prefix[1] === 0x4b;
  const mediaType = pdf ? 'application/pdf' : zip ? 'application/zip' : 'application/octet-stream';
  if (declared && declared !== mediaType && declared !== 'application/octet-stream') return { allowed: false, reason: 'mime_spoof' };
  if (archive) { if (!archive.supported) return { allowed: false, reason: 'unsupported_archive' }; if (archive.encrypted) return { allowed: false, reason: 'encrypted_archive' }; if (archive.expandedBytes > 2n * 1024n * 1024n * 1024n) return { allowed: false, reason: 'archive_bomb' }; if (archive.paths.some(path => path.startsWith('/') || path.includes('\\') || path.split('/').some(part => part === '..'))) return { allowed: false, reason: 'unsafe_archive_path' }; }
  return { allowed: true, mediaType };
}
