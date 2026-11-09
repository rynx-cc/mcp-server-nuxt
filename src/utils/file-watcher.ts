/**
 * Optional file watching for project changes.
 *
 * Kept deliberately small and dependency-free (no chokidar by default) so the
 * server starts instantly. A lightweight polling watcher is used instead.
 */
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface WatchEvent {
  type: 'add' | 'change' | 'unlink';
  path: string;
}

export class ProjectWatcher extends EventEmitter {
  private timers = new Map<string, NodeJS.Timeout>();
  private snapshots = new Map<string, string>();
  private running = false;

  constructor(
    private readonly root: string,
    private readonly intervalMs = 2000,
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.scan();
    this.loop();
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, this.intervalMs));
      await this.scan();
    }
  }

  private async scan(): Promise<void> {
    const files = await this.walk(this.root);
    const seen = new Set<string>();

    for (const file of files) {
      seen.add(file);
      const before = this.snapshots.get(file);
      const after = await this.hash(file);
      if (before === undefined) {
        this.snapshots.set(file, after);
        this.emit('change', { type: 'add', path: file } satisfies WatchEvent);
      } else if (before !== after) {
        this.snapshots.set(file, after);
        this.emit('change', { type: 'change', path: file } satisfies WatchEvent);
      }
    }

    for (const [file] of this.snapshots) {
      if (!seen.has(file)) {
        this.snapshots.delete(file);
        this.emit('change', { type: 'unlink', path: file } satisfies WatchEvent);
      }
    }
  }

  private async walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.nuxt' || entry.name === '.output' || entry.name === '.git' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await this.walk(full)));
      else if (entry.isFile()) out.push(full);
    }
    return out;
  }

  private async hash(file: string): Promise<string> {
    try {
      const stat = await fs.stat(file);
      return `${stat.size}:${stat.mtimeMs}`;
    } catch {
      return 'missing';
    }
  }
}
