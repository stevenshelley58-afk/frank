#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = join(process.cwd(), 'apps/web/src');
// These are known non-chat forms: a component-gallery control and console memory note.
const composerFiles = new Set(['components/composer.tsx', 'components/shell/composer-bar.tsx']);
const nonChatForms = new Set(['app/dev/shadcn-kitchen-sink/page.tsx', 'app/console/memory/memory-console.tsx']);
function walk(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]); }
const offenders = walk(root).filter((file) => /\.[jt]sx$/.test(file)).map((file) => [file, readFileSync(file, 'utf8'), file.slice(root.length + 1).replaceAll('\\', '/')]).filter(([, source, relative]) => source.includes('<textarea') && (composerFiles.has(relative) ? !source.includes('SharedRichComposer') : !nonChatForms.has(relative)));
if (offenders.length) { console.error(`Standalone chat textarea guard failed:\n${offenders.map(([file]) => file).join('\n')}`); process.exit(1); }
