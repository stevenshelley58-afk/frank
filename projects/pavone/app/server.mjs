import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SHADES, getShade } from './src/shades.mjs';
import { renderTint, DEFAULT_MODEL } from './src/gemini.mjs';
import { saveRender, getRender, saveLead, listLeads, peekRateLimit, consumeRateLimit, pruneOldFiles } from './src/store.mjs';

const PORT = parseInt(process.env.PORT || '8787', 10);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || DEFAULT_MODEL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
// Resolve relative to this file, never an absolute build-host path — this has to
// work identically in the container, on the VPS, and inside Docker.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
const MAX_BODY_SIZE = 8 * 1024 * 1024;
const RENDER_LIMIT_PER_DAY = parseInt(process.env.RENDER_LIMIT_PER_DAY || '3', 10);
const MAX_FIELD_LEN = 200;

// A tiny real JPEG used by /api/selftest to prove the key can actually
// generate images. hasKey:true only means a key is SET — it says nothing about
// whether the project has image-generation quota. This is the difference.
const PROBE_JPEG_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCaiiiuowCiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooA//Z';


// Every value that reaches the admin page comes from an unauthenticated POST,
// so it is escaped before it is ever interpolated into HTML.
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clean(value) {
  if (typeof value !== 'string') return '';
  // Strip control characters (incl. newlines, which would corrupt the JSONL store)
  // and cap length so a single POST cannot bloat leads.jsonl.
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_FIELD_LEN);
}

// Get client IP from x-forwarded-for or socket
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '0.0.0.0';
}

// Timing-safe password comparison
function verifyPassword(provided, expected) {
  if (!expected) return false;
  const providedBuf = Buffer.from(provided || '', 'utf-8');
  const expectedBuf = Buffer.from(expected, 'utf-8');
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

// Read request body with size limit
async function readBody(req, maxSize = MAX_BODY_SIZE) {
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > maxSize) {
    const err = new Error('Payload too large');
    err.statusCode = 413;
    throw err;
  }

  let buffer = Buffer.alloc(0);
  for await (const chunk of req) {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > maxSize) {
      const err = new Error('Payload too large');
      err.statusCode = 413;
      throw err;
    }
  }
  return buffer.toString('utf-8');
}

// Send JSON response
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// Safe path resolution with traversal protection
function resolvePath(basePath, reqPath) {
  const cleanPath = reqPath.startsWith('/') ? reqPath.slice(1) : reqPath;
  const resolved = path.normalize(path.join(basePath, cleanPath));
  if (!resolved.startsWith(basePath + path.sep) && resolved !== basePath) {
    return null;
  }
  return resolved;
}

// Get MIME type by file extension
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };
  return mimes[ext] || 'application/octet-stream';
}

// Handler: GET /api/health
function handleHealth(res) {
  sendJson(res, 200, {
    ok: true,
    model: GEMINI_MODEL,
    hasKey: !!GEMINI_API_KEY,
    version: '1.0.0',
  });
}

// Handler: GET /api/selftest (admin-authed) — spends ONE render to answer
// "will this actually work in production?" definitively.
async function handleSelfTest(req, res) {
  if (!checkAdminAuth(req, res)) return;
  if (!GEMINI_API_KEY) {
    return sendJson(res, 200, { ok: false, stage: 'config', reason: 'GEMINI_API_KEY is empty' });
  }
  const started = Date.now();
  try {
    const out = await renderTint({
      imageBase64: PROBE_JPEG_B64,
      mime: 'image/jpeg',
      shadeId: 'vlt35',
      apiKey: GEMINI_API_KEY,
      model: GEMINI_MODEL,
    });
    return sendJson(res, 200, {
      ok: true, stage: 'render', model: GEMINI_MODEL,
      bytes: Buffer.from(out.imageBase64, 'base64').length,
      ms: Date.now() - started,
    });
  } catch (err) {
    const msg = String(err.message || '');
    // Distinguish "no quota at all" from "temporarily rate limited" — they need
    // completely different fixes and the raw message buries the difference.
    const reason = /limit: 0/.test(msg)
      ? 'This project has ZERO image-generation quota. Enable billing on the Google Cloud project behind this API key.'
      : /429/.test(msg) ? 'Rate limited right now — retry shortly.'
      : /403|PERMISSION_DENIED|API key not valid/.test(msg) ? 'API key rejected.'
      : 'Model call failed.';
    return sendJson(res, 200, { ok: false, stage: 'render', model: GEMINI_MODEL, reason, detail: msg.slice(0, 400), ms: Date.now() - started });
  }
}

// Handler: POST /api/render
async function handleRender(req, res) {
  const clientIp = getClientIp(req);
  // Peek only. Quota is consumed after a SUCCESSFUL render (below) so that a
  // customer whose render fails is not locked out having seen nothing.
  const rateCheck = peekRateLimit(clientIp, RENDER_LIMIT_PER_DAY);

  if (!rateCheck.allowed) {
    return sendJson(res, 429, {
      ok: false,
      error: 'Rate limit exceeded',
      fallback: true,
    });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    if (err.statusCode === 413) {
      return sendJson(res, 413, { ok: false, error: 'Payload too large' });
    }
    return sendJson(res, 400, { ok: false, error: 'Bad request' });
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
  }

  const { imageBase64, mime, shadeId } = data;
  if (!imageBase64 || !mime || !shadeId) {
    return sendJson(res, 400, { ok: false, error: 'Missing required fields' });
  }

  const shade = getShade(shadeId);
  if (!shade) {
    return sendJson(res, 400, { ok: false, error: 'Unknown shade' });
  }

  try {
    const result = await renderTint({
      imageBase64,
      mime,
      shadeId,
      apiKey: GEMINI_API_KEY,
      model: GEMINI_MODEL,
    });

    const { renderId } = await saveRender({
      shadeId,
      imageBase64: result.imageBase64,
      mime: result.mime,
    });

    const after = consumeRateLimit(clientIp, RENDER_LIMIT_PER_DAY);

    return sendJson(res, 200, {
      ok: true,
      renderId,
      imageBase64: result.imageBase64,
      mime: result.mime,
      remaining: after.remaining,
    });
  } catch (err) {
    // Log the upstream detail server-side; never hand the provider's raw error
    // (which can echo request/key context) back to an anonymous caller.
    console.error('Render error:', err.message);
    return sendJson(res, 502, {
      ok: false,
      error: 'We could not generate that preview just now.',
      fallback: true,
    });
  }
}

// Handler: POST /api/lead
async function handleLead(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    if (err.statusCode === 413) {
      return sendJson(res, 413, { ok: false, error: 'Payload too large' });
    }
    return sendJson(res, 400, { ok: false, error: 'Bad request' });
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
  }

  const name = clean(data.name);
  const phone = clean(data.phone);
  const email = clean(data.email);
  const vehicle = clean(data.vehicle);
  const shadeId = getShade(data.shadeId) ? data.shadeId : '';
  const renderId = /^[0-9a-f-]{36}$/i.test(data.renderId || '') ? data.renderId : '';

  if (!name || !phone) {
    return sendJson(res, 400, { ok: false, error: 'Name and phone required' });
  }

  try {
    const { leadId } = await saveLead({
      name,
      phone,
      email,
      vehicle,
      shadeId,
      renderId,
    });

    return sendJson(res, 200, { ok: true, leadId });
  } catch (err) {
    console.error('Lead save error:', err.message);
    return sendJson(res, 500, { ok: false, error: 'Failed to save lead' });
  }
}

// Handler: GET /r/<renderId>.jpg
async function handleRenderImage(req, res, renderId) {
  if (renderId.includes('/') || renderId.includes('..')) {
    res.writeHead(404);
    res.end();
    return;
  }

  try {
    const render = await getRender(renderId);
    if (!render) {
      res.writeHead(404);
      res.end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': render.mime,
      'Cache-Control': 'private',
      'Content-Length': render.buffer.length,
    });
    res.end(render.buffer);
  } catch (err) {
    console.error('Render fetch error:', err.message);
    res.writeHead(500);
    res.end();
  }
}

// Handler: GET /admin
function checkAdminAuth(req, res) {
  const auth = req.headers.authorization || '';
  const match = auth.match(/^Basic\s+(.+)$/);
  const deny = () => {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Admin"' });
    res.end();
    return false;
  };
  if (!match) return deny();
  const credentials = Buffer.from(match[1], 'base64').toString('utf-8');
  // Split on the FIRST colon only — passwords may legitimately contain colons.
  const colonIndex = credentials.indexOf(':');
  const password = colonIndex > -1 ? credentials.slice(colonIndex + 1) : '';
  if (!verifyPassword(password, ADMIN_PASSWORD)) return deny();
  return true;
}

async function handleAdmin(req, res) {
  if (!checkAdminAuth(req, res)) return;

  try {
    const leads = await listLeads();

    const tableRows = leads
      .map(
        (lead) =>
          `<tr>
        <td>${esc(lead.createdAt)}</td>
        <td>${esc(lead.name)}</td>
        <td><a href="tel:${esc(lead.phone)}">${esc(lead.phone)}</a></td>
        <td>${lead.email ? `<a href="mailto:${esc(lead.email)}">${esc(lead.email)}</a>` : '-'}</td>
        <td>${esc(lead.vehicle) || '-'}</td>
        <td>${esc(getShade(lead.shadeId)?.label || lead.shadeId || '-')}</td>
        <td>${/^[0-9a-f-]{36}$/i.test(lead.renderId || '') ? `<a href="/r/${esc(lead.renderId)}.jpg" target="_blank"><img src="/r/${esc(lead.renderId)}.jpg" alt="Render" style="max-width:120px;height:auto;border-radius:6px;"></a>` : '-'}</td>
      </tr>`
      )
      .join('\n');

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PAVONE Admin</title>
  <style>
    body {
      background: #0b100e;
      color: #93a49e;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 20px;
    }
    h1 { color: #d8c08a; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #121917;
      border: 1px solid #22302b;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #22302b;
    }
    th {
      background: #22302b;
      color: #d8c08a;
      font-weight: 600;
    }
    tr:hover { background: #1a2220; }
  </style>
</head>
<body>
  <h1>PAVONE Leads <span style="color:#3fb397;font-size:15px;font-weight:400">${leads.length}</span></h1>
  <table>
    <thead>
      <tr>
        <th>Received</th>
        <th>Name</th>
        <th>Phone</th>
        <th>Email</th>
        <th>Vehicle</th>
        <th>Shade</th>
        <th>Their car</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (err) {
    console.error('Admin error:', err.message);
    res.writeHead(500);
    res.end('Error loading leads');
  }
}

// Handler: static file serving
async function serveStatic(req, res, pathname) {
  const safePath = resolvePath(PUBLIC_DIR, pathname === '/' ? '/index.html' : pathname);
  if (!safePath) {
    res.writeHead(404);
    res.end();
    return;
  }

  try {
    // Async so a static request cannot block the event loop while a 5-15s
    // render is in flight on another connection.
    const stats = await fsp.stat(safePath);
    if (!stats.isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }

    const buffer = await fsp.readFile(safePath);
    const mimeType = getMimeType(safePath);

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  } catch {
    res.writeHead(404);
    res.end();
  }
}

// Main request handler
async function handleRequest(req, res) {
  const startTime = Date.now();
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      handleHealth(res);
    } else if (pathname === '/api/shades' && req.method === 'GET') {
      // One source of truth for shade labels and QLD legality. The client
      // hydrates from this so the badge a customer sees can never drift from
      // the rule the server applies.
      sendJson(res, 200, {
        ok: true,
        shades: SHADES.map(({ id, label, vlt, privacy, legal, badge }) => ({ id, label, vlt, privacy, legal, badge })),
      });
    } else if (pathname === '/api/render' && req.method === 'POST') {
      await handleRender(req, res);
    } else if (pathname === '/api/lead' && req.method === 'POST') {
      await handleLead(req, res);
    } else if (pathname.startsWith('/r/') && req.method === 'GET') {
      const renderId = pathname.slice(3).replace(/\.jpg$/, '');
      await handleRenderImage(req, res, renderId);
    } else if (pathname === '/api/selftest' && req.method === 'GET') {
      await handleSelfTest(req, res);
    } else if (pathname === '/admin' && req.method === 'GET') {
      await handleAdmin(req, res);
    } else if (req.method === 'GET') {
      await serveStatic(req, res, pathname);
    } else {
      res.writeHead(405);
      res.end();
    }
  } catch (err) {
    console.error('Unhandled error:', err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end();
    }
  }

  const duration = Date.now() - startTime;
  const status = res.statusCode || 500;
  console.log(`${req.method} ${pathname} ${status} ${duration}ms`);
}

// Create and start server
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  pruneOldFiles(30).catch(console.error);
});

// Prune old files every 6 hours
const pruneInterval = setInterval(() => {
  pruneOldFiles(30).catch(console.error);
}, 6 * 60 * 60 * 1000);
pruneInterval.unref();
