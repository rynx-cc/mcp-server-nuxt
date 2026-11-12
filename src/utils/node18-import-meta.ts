/**
 * Node 18 does not define `import.meta.dirname` or `import.meta.filename`
 * (they arrived in Node 20.11 / 21.2). Current Nuxt dependencies such as
 * `unplugin` evaluate `path.resolve(import.meta.dirname, ...)` at import
 * time, which throws `The "paths[0]" argument must be of type string`.
 *
 * Before importing `@nuxt/kit`, register an ESM loader that rewrites those
 * property reads to `fileURLToPath(import.meta.url)`. String literals stay
 * untouched so diagnostic messages that mention the names are preserved.
 *
 * The loader source is a plain string. Function#toString() is not used:
 * esbuild/tsx inject a `__name` helper that does not exist in the loader's
 * isolated module.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

export const NODE18_IMPORT_META_LOADER_SOURCE = `
import * as __mcpNodeUtilCheck from 'node:util';

const DIRNAME = 'import.meta.dirname';
const FILENAME = 'import.meta.filename';

function isIdentChar(ch) {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}

export function rewriteImportMetaPaths(source) {
  let out = '';
  let i = 0;
  let changed = false;
  let state = 'code';

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === 'line') {
      out += ch;
      if (ch === '\\n') state = 'code';
      i++;
      continue;
    }
    if (state === 'block') {
      out += ch;
      if (ch === '*' && next === '/') {
        out += '/';
        i += 2;
        state = 'code';
        continue;
      }
      i++;
      continue;
    }
    if (state === 'squote' || state === 'dquote' || state === 'tmpl') {
      out += ch;
      if (ch === '\\\\') {
        if (next !== undefined) out += next;
        i += 2;
        continue;
      }
      const end = state === 'squote' ? "'" : state === 'dquote' ? '"' : '\`';
      if (ch === end) state = 'code';
      i++;
      continue;
    }

    if (ch === '/' && next === '/') {
      out += '//';
      i += 2;
      state = 'line';
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '/*';
      i += 2;
      state = 'block';
      continue;
    }
    if (ch === "'") {
      out += ch;
      i++;
      state = 'squote';
      continue;
    }
    if (ch === '"') {
      out += ch;
      i++;
      state = 'dquote';
      continue;
    }
    if (ch === '\`') {
      out += ch;
      i++;
      state = 'tmpl';
      continue;
    }

    if (!isIdentChar(source[i - 1]) && source.startsWith(DIRNAME, i) && !isIdentChar(source[i + DIRNAME.length])) {
      out += '__mcpDirname(import.meta.url)';
      i += DIRNAME.length;
      changed = true;
      continue;
    }
    if (!isIdentChar(source[i - 1]) && source.startsWith(FILENAME, i) && !isIdentChar(source[i + FILENAME.length])) {
      out += '__mcpFilename(import.meta.url)';
      i += FILENAME.length;
      changed = true;
      continue;
    }

    out += ch;
    i++;
  }

  if (!changed) return null;
  const header =
    "import { fileURLToPath as __mcpFileURLToPath } from 'node:url';\\n" +
    "import { dirname as __mcpPathDirname } from 'node:path';\\n" +
    'const __mcpFilename = (u) => __mcpFileURLToPath(u);\\n' +
    'const __mcpDirname = (u) => __mcpPathDirname(__mcpFileURLToPath(u));\\n';
  if (out.startsWith('#!')) {
    const nl = out.indexOf('\\n');
    if (nl !== -1) return out.slice(0, nl + 1) + header + out.slice(nl + 1);
  }
  return header + out;
}

function __mcpParseEnv(content) {
  const env = Object.create(null);
  for (const rawLine of String(content).split(/\\r?\\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let key = line.slice(0, eq).trim();
    if (key.startsWith('export ')) key = key.slice(7).trim();
    let value = line.slice(eq + 1).trim();
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

function shimNodeUtilImport(source) {
  let utilImportCount = 0;
  return source.replace(/import\\s*\\{([^}]+)\\}\\s*from\\s*(['"])node:util\\2/g, (full, names, quote) => {
    const bindings = names.split(',').map((part) => part.trim()).filter(Boolean);
    if (bindings.length === 0) return full;
    utilImportCount += 1;
    const alias = '__mcpNodeUtil' + utilImportCount;
    const lines = ['import * as ' + alias + ' from ' + quote + 'node:util' + quote + ';'];
    for (const binding of bindings) {
      const parts = binding.split(/\\s+as\\s+/);
      const imported = parts[0].trim();
      const local = (parts[1] || parts[0]).trim();
      if (!(imported in __mcpNodeUtilCheck)) {
        if (imported === 'styleText') {
          lines.push('const ' + local + ' = (_format, text) => String(text ?? "");');
          continue;
        }
        if (imported === 'parseEnv') {
          lines.push('const ' + local + ' = ' + __mcpParseEnv.toString() + ';');
          continue;
        }
      }
      lines.push('const ' + local + ' = ' + alias + '.' + imported + ';');
    }
    return lines.join('\\n');
  });
}

export function rewriteNode18Module(source) {
  const shimmed = shimNodeUtilImport(source);
  const rewritten = rewriteImportMetaPaths(shimmed);
  const next = rewritten ?? shimmed;
  return next === source ? null : next;
}

export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  if (!loaded || loaded.format !== 'module' || loaded.source == null) return loaded;
  const source = typeof loaded.source === 'string' ? loaded.source : Buffer.from(loaded.source).toString('utf8');
  if (!source.includes(DIRNAME) && !source.includes(FILENAME) && !source.includes('node:util')) return loaded;
  const rewritten = rewriteNode18Module(source);
  if (!rewritten) return loaded;
  return { ...loaded, source: rewritten };
}
`;

export function node18ImportMetaLoaderSource(): string {
  return NODE18_IMPORT_META_LOADER_SOURCE;
}

let installed: Promise<void> | undefined;

/** Register the loader once. No-op on Node builds that do not expose `module.register`. */
export async function installNode18ImportMetaPaths(): Promise<void> {
  if (!installed) {
    installed = (async () => {
      if (typeof register !== 'function') return;
      const href = 'data:text/javascript,' + encodeURIComponent(NODE18_IMPORT_META_LOADER_SOURCE);
      await register(href, { parentURL: import.meta.url });
    })();
  }
  return installed;
}
