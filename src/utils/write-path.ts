/**
 * Resolve a scaffolding destination and refuse anything that leaves the
 * project (or the directory the tool is allowed to write in).
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';

async function existingRealpath(target: string): Promise<string> {
  let cursor = path.resolve(target);
  const suffix: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(cursor);
      return path.resolve(real, ...suffix);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
      suffix.unshift(path.basename(cursor));
      const parent = path.dirname(cursor);
      if (parent === cursor) return path.resolve(cursor, ...suffix);
      cursor = parent;
    }
  }
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Resolve `target` and throw when it escapes `boundary` via `..` or a symlink. */
export async function resolveContained(boundary: string, target: string): Promise<string> {
  if (target.includes('\0') || boundary.includes('\0')) {
    throw new Error('Refusing to write a path that contains a null byte');
  }
  const root = await existingRealpath(path.resolve(boundary));
  let cursor = path.resolve(target);
  const suffix: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(cursor);
      const finalPath = path.resolve(real, ...suffix);
      if (!isInside(root, finalPath)) {
        throw new Error(`Refusing to write outside ${root}: ${finalPath}`);
      }
      return finalPath;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Refusing to write outside')) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
      suffix.unshift(path.basename(cursor));
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw new Error(`Refusing to write outside ${root}: ${path.resolve(target)}`);
      }
      cursor = parent;
    }
  }
}

export async function prepareWrite(
  projectRoot: string,
  boundary: string,
  target: string,
): Promise<{ file: string; exists: boolean }> {
  const inBoundary = await resolveContained(boundary, target);
  const file = await resolveContained(projectRoot, inBoundary);
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to write through a symlink: ${target}`);
    }
    return { file, exists: true };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Refusing to write')) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { file, exists: false };
  }
}
