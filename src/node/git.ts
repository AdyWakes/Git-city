import { spawn, execFile } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { promisify } from 'node:util';
import { GIT_LOG_ARGS, GitLogParser, type Commit } from '../core/parser.js';

const execFileP = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await git(dir, ['rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}

export async function repoRoot(dir: string): Promise<string> {
  return (await git(dir, ['rev-parse', '--show-toplevel'])).trim();
}

/** Returns 0 for repositories without any commit. */
export async function countCommits(dir: string, rev = 'HEAD'): Promise<number> {
  try {
    return Number((await git(dir, ['rev-list', '--count', rev])).trim()) || 0;
  } catch {
    return 0;
  }
}

export async function headInfo(dir: string): Promise<{ head: string; branch: string; remote: string }> {
  const safe = async (args: string[]) => {
    try {
      return (await git(dir, args)).trim();
    } catch {
      return '';
    }
  };
  return {
    head: await safe(['rev-parse', 'HEAD']),
    branch: await safe(['rev-parse', '--abbrev-ref', 'HEAD']),
    remote: await safe(['config', '--get', 'remote.origin.url']),
  };
}

/**
 * Streams `git log` through the parser. Only one commit is held in memory at a time;
 * `onCommit` receives commits oldest first.
 */
export function streamCommits(dir: string, onCommit: (c: Commit) => void, rev = 'HEAD'): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...GIT_LOG_ARGS, rev, '--'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    const decoder = new StringDecoder('utf8');
    let error: unknown = null;
    const parser = new GitLogParser((c) => {
      if (error) return;
      try {
        onCommit(c);
      } catch (e) {
        error = e;
        child.kill();
      }
    });
    let stderr = '';
    child.stdout.on('data', (b: Buffer) => parser.write(decoder.write(b)));
    child.stderr.on('data', (b: Buffer) => {
      if (stderr.length < 4000) stderr += b.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (error) return reject(error);
      parser.write(decoder.end());
      parser.end();
      if (code !== 0 && parser.count === 0) {
        return reject(new Error(`git log failed (${code}): ${stderr.trim()}`));
      }
      resolve(parser.count);
    });
  });
}
