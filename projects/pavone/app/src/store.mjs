import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Default resolves relative to this file so it is correct in the container,
// on the VPS, and inside Docker alike. Never a build-host absolute path.
const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

// In-memory rate limit map: key = `ip:YYYY-MM-DD`, value = count
const rateLimitMap = new Map();

// Helper: ensure directories exist
async function ensureDir(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (err) {
    // Ignore if already exists
    if (err.code !== 'EEXIST') throw err;
  }
}

// Helper: validate that renderId is a UUID (no / or ..)
function isValidUUID(id) {
  // UUID format: 8-4-4-4-12 hex chars
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Save a render image with metadata
 * @param {Object} options
 * @param {string} options.shadeId - The shade ID
 * @param {string} options.imageBase64 - The image data as base64 (WITHOUT data: prefix)
 * @param {string} options.mime - The MIME type (e.g., 'image/jpeg')
 * @returns {Promise<{renderId: string}>}
 */
export async function saveRender({ shadeId, imageBase64, mime }) {
  const renderId = crypto.randomUUID();
  const dataDir = path.join(DATA_DIR, 'renders');

  await ensureDir(dataDir);

  // Convert base64 to binary buffer
  const imageBuffer = Buffer.from(imageBase64, 'base64');

  // Write the image file (always as .jpg)
  const imagePath = path.join(dataDir, `${renderId}.jpg`);
  await fs.writeFile(imagePath, imageBuffer);

  // Write the metadata sidecar JSON
  const metaPath = path.join(dataDir, `${renderId}.json`);
  const metadata = {
    shadeId,
    mime,
    createdAt: new Date().toISOString()
  };
  await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));

  return { renderId };
}

/**
 * Retrieve a render image
 * @param {string} renderId - The render ID (must be a valid UUID)
 * @returns {Promise<{buffer: Buffer, mime: string}|null>} Render data or null if not found
 */
export async function getRender(renderId) {
  // Validate renderId: must be a valid UUID, no path traversal
  if (!isValidUUID(renderId)) {
    return null;
  }

  const imagePath = path.join(DATA_DIR, 'renders', `${renderId}.jpg`);
  const metaPath = path.join(DATA_DIR, 'renders', `${renderId}.json`);

  try {
    const buffer = await fs.readFile(imagePath);

    // Try to read metadata to get mime type, but don't fail if missing
    let mime = 'image/jpeg'; // default fallback
    try {
      const metaContent = await fs.readFile(metaPath, 'utf8');
      const meta = JSON.parse(metaContent);
      if (meta.mime) {
        mime = meta.mime;
      }
    } catch (err) {
      // Ignore metadata read errors, use default mime
    }

    return { buffer, mime };
  } catch (err) {
    // File doesn't exist or other error
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Save a lead capture
 * @param {Object} lead - Lead data { name, phone, email, vehicle, shadeId, renderId }
 * @returns {Promise<{leadId: string}>}
 */
export async function saveLead(lead) {
  const leadId = crypto.randomUUID();
  const dataDir = DATA_DIR;

  await ensureDir(dataDir);

  // Create a lead object with metadata
  const leadRecord = {
    leadId,
    ...lead,
    createdAt: new Date().toISOString()
  };

  const leadsPath = path.join(dataDir, 'leads.jsonl');
  const jsonLine = JSON.stringify(leadRecord);

  // Append to the JSONL file
  await fs.appendFile(leadsPath, jsonLine + '\n', 'utf8');

  return { leadId };
}

/**
 * List all leads, newest first
 * @returns {Promise<Array>} Array of lead objects, newest first
 */
export async function listLeads() {
  const leadsPath = path.join(DATA_DIR, 'leads.jsonl');

  try {
    const content = await fs.readFile(leadsPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());
    const leads = lines.map(line => JSON.parse(line));

    // Sort by createdAt, newest first
    leads.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return leads;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Check rate limit for an IP address
 * @param {string} ip - Client IP address
 * @param {number} limit - Max requests per day (default 3)
 * @returns {{allowed: boolean, remaining: number}}
 */
export function peekRateLimit(ip, limit = 3) {
  const today = new Date().toISOString().split('T')[0]; // UTC day bucket
  const current = rateLimitMap.get(`${ip}:${today}`) || 0;
  return { allowed: current < limit, remaining: Math.max(0, limit - current) };
}

export function consumeRateLimit(ip, limit = 3) {
  const today = new Date().toISOString().split('T')[0];
  const key = `${ip}:${today}`;
  const current = rateLimitMap.get(key) || 0;
  rateLimitMap.set(key, current + 1);
  return { allowed: current < limit, remaining: Math.max(0, limit - (current + 1)) };
}

// Back-compat: peek + consume in one call.
export function checkRateLimit(ip, limit = 3) {
  const peek = peekRateLimit(ip, limit);
  if (peek.allowed) return consumeRateLimit(ip, limit);
  return peek;
}


/**
 * Delete render files older than maxAgeDays
 * @param {number} maxAgeDays - Max age in days (default 30)
 * @returns {Promise<number>} Number of files deleted
 */
export async function pruneOldFiles(maxAgeDays = 30) {
  const rendersDir = path.join(DATA_DIR, 'renders');
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  let deletedCount = 0;

  try {
    const files = await fs.readdir(rendersDir);

    for (const file of files) {
      const filePath = path.join(rendersDir, file);
      try {
        const stats = await fs.stat(filePath);
        const age = now - stats.mtimeMs;

        if (age > maxAgeMs) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      } catch (err) {
        // Skip files we can't stat or delete
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      // renders directory doesn't exist, nothing to prune
      return 0;
    }
    throw err;
  }

  return deletedCount;
}
