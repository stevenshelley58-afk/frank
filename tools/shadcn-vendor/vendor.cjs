/**
 * vendor.js — extract fetched shadcn registry JSON into apps/web/src/components/ui/.
 * One-shot for Track A1; kept in-repo under tools/ so re-vendoring is repeatable.
 */
const fs = require('fs');
const path = require('path');

const REG = path.join(__dirname, 'registry');
const DEST = path.join(__dirname, '..', '..', 'apps', 'web', 'src', 'components', 'ui');
fs.mkdirSync(DEST, { recursive: true });

const allDeps = new Set();
const lucide = new Map();

for (const file of fs.readdirSync(REG).filter((f) => f.endsWith('.json'))) {
  const item = JSON.parse(fs.readFileSync(path.join(REG, file), 'utf8'));
  for (const f of item.files || []) {
    const rel = f.path.replace(/^ui\//, '');
    let content = f.content;
    // registry content already uses "@/lib/utils" which matches Frank's tsconfig paths.
    const out = path.join(DEST, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, content);
    console.log('WROTE', path.relative(process.cwd(), out));
  }
  for (const d of item.dependencies || []) allDeps.add(d);
  // collect lucide imports for the icon-swap step
  for (const f of item.files || []) {
    const m = f.content.match(/import\s*\{([^}]+)\}\s*from\s*"lucide-react"/g) || [];
    for (const im of m) {
      const names = im.match(/\{([^}]+)\}/)[1].split(',').map((s) => s.trim().replace(/ as .+/, ''));
      names.forEach((n) => lucide.set(n, (lucide.get(n) || 0) + 1));
    }
  }
}

console.log('\n== npm dependencies needed:');
console.log([...allDeps].filter((d) => d !== 'next-themes').join(' '));
console.log('\n== lucide-react icons referenced:');
console.log([...lucide.entries()].map(([n, c]) => `${n}(${c})`).join(', '));
