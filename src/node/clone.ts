import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Recognises clone URLs and the `owner/repo` GitHub shorthand. */
export function remoteUrl(target: string): string | null {
  const t = target.trim();
  if (/^(https?|ssh|git|file):\/\/\S+$/i.test(t) || /^[\w.-]+@[\w.-]+:\S+$/.test(t)) return t;
  if (/^(www\.)?(github\.com|gitlab\.com|codeberg\.org|bitbucket\.org)\/[\w.-]+\/[\w.-]+\/?$/i.test(t)) return `https://${t.replace(/^www\./i, '')}`;
  // `owner/repo` (only when no such local folder exists; checked by the caller).
  if (/^[\w-][\w.-]*\/[\w.-]+$/.test(t) && !t.startsWith('.')) return `https://github.com/${t}`;
  return null;
}

/** "https://github.com/user/repo.git" -> "user/repo" */
export function repoNameFromUrl(url: string): string {
  const clean = url.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/, '');
  const parts = clean.split(/[/:]/).filter(Boolean);
  return parts.slice(-2).join('/') || 'repo';
}

export interface CloneProgress {
  phase: string;
  percent: number;
  detail: string;
}

export interface Clone {
  dir: string;
  cleanup(): void;
}

/**
 * Full (bare) clone into a temp folder. Bare is a complete copy of history without a working
 * tree, which is all `git log --numstat` needs, and saves the checkout time and disk.
 */
export function cloneRepo(url: string, onProgress?: (p: CloneProgress) => void): Promise<Clone> {
  const dir = mkdtempSync(join(tmpdir(), 'gitcity-'));
  const repoDir = join(dir, 'repo.git');
  const cleanup = () => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  };
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['clone', '--bare', '--progress', '--', url, repoDir], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    let tail = '';
    let buf = '';
    child.stderr.on('data', (b: Buffer) => {
      buf += b.toString();
      const parts = buf.split(/[\r\n]/);
      buf = parts.pop() ?? '';
      for (const line of parts) {
        if (!line.trim()) continue;
        tail = (tail + '\n' + line).slice(-2000);
        const m = /^(?:remote: )?([A-Za-z ]+):\s+(\d+)%(?:\s+\((\d+)\/(\d+)\))?(.*)$/.exec(line.trim());
        if (m && onProgress) onProgress({ phase: m[1].trim(), percent: Number(m[2]), detail: (m[5] ?? '').replace(/^,\s*/, '').replace(/, done\.?$/, '').trim() });
      }
    });
    child.on('error', (e) => {
      cleanup();
      reject(e);
    });
    child.on('close', (code) => {
      if (code === 0) return resolve({ dir: repoDir, cleanup });
      cleanup();
      const msg = tail
        .split('\n')
        .filter((l) => /fatal|error/i.test(l))
        .join(' ')
        .trim();
      if (/could not read Username|Repository not found|not found/i.test(msg)) {
        return reject(new Error('repository not found (or it is private: clone it yourself and run gitcity on the folder)'));
      }
      reject(new Error(msg || `git clone exited with code ${code}`));
    });
  });
}
