import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

/** Tiny scripted git repo for integration tests. Commits get fixed, increasing dates. */
export class TestRepo {
  readonly dir: string;
  private t = 1_600_000_000;
  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'gitcity-test-'));
    this.git('init', '-q', '-b', 'main');
    this.git('config', 'user.name', 'Test');
    this.git('config', 'user.email', 'test@example.com');
    this.git('config', 'commit.gpgsign', 'false');
  }
  git(...args: string[]): string {
    return execFileSync('git', args, {
      cwd: this.dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: `${this.t} +0000`,
        GIT_COMMITTER_DATE: `${this.t} +0000`,
      },
    });
  }
  write(path: string, lines: number | string): this {
    const p = join(this.dir, path);
    mkdirSync(dirname(p), { recursive: true });
    const body = typeof lines === 'number' ? Array.from({ length: lines }, (_, i) => `line ${i}\n`).join('') : lines;
    writeFileSync(p, body);
    return this;
  }
  rm(path: string): this {
    rmSync(join(this.dir, path));
    return this;
  }
  mv(from: string, to: string): this {
    mkdirSync(dirname(join(this.dir, to)), { recursive: true });
    renameSync(join(this.dir, from), join(this.dir, to));
    return this;
  }
  commit(msg: string, author?: { name: string; email: string }): this {
    this.t += 3600;
    this.git('add', '-A');
    const args = ['commit', '-q', '--allow-empty', '-m', msg];
    if (author) args.push(`--author=${author.name} <${author.email}>`);
    this.git(...args);
    return this;
  }
  tick(): number {
    this.t += 3600;
    return this.t;
  }
  cleanup(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}
