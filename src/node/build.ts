import { basename } from 'node:path';
import { CityBuilder, type FinalizeOptions } from '../core/builder.js';
import type { CityData } from '../core/format.js';
import { countCommits, headInfo, streamCommits } from './git.js';

export interface BuildOptions {
  maxBuildings?: number;
  maxTicks?: number;
  name?: string;
  url?: string;
  generator?: string;
  generatedAt?: string;
  onProgress?: (done: number, total: number) => void;
}

/** Streams a repository's history into a laid-out city. */
export async function buildCity(dir: string, opts: BuildOptions = {}): Promise<CityData> {
  const total = await countCommits(dir);
  const info = await headInfo(dir);
  const builder = new CityBuilder({ totalCommits: total, maxTicks: opts.maxTicks });
  if (total > 0) {
    let lastReport = 0;
    await streamCommits(dir, (c) => {
      builder.addCommit(c);
      const n = builder.commitsSeen;
      if (opts.onProgress && (n - lastReport >= 500 || n === total)) {
        lastReport = n;
        opts.onProgress(n, total);
      }
    });
  }
  const repo: FinalizeOptions['repo'] = {
    name: opts.name ?? nameFromRemote(info.remote) ?? basename(dir),
  };
  const url = opts.url ?? httpUrl(info.remote);
  if (url) repo.url = url;
  if (info.branch && info.branch !== 'HEAD') repo.branch = info.branch;
  if (info.head) repo.head = info.head;
  return builder.finalize({
    maxBuildings: opts.maxBuildings,
    repo,
    generator: opts.generator,
    generatedAt: opts.generatedAt,
  });
}

/** "git@github.com:user/repo.git" / "https://github.com/user/repo" -> "user/repo" */
export function nameFromRemote(remote: string): string | undefined {
  const m = /[/:]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(remote.trim());
  return m ? m[1] : undefined;
}

export function httpUrl(remote: string): string | undefined {
  const r = remote.trim();
  if (!r) return undefined;
  if (/^https?:\/\//.test(r)) return r.replace(/\.git$/, '').replace(/\/\/[^@/]+@/, '//');
  const m = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(r);
  return m ? `https://${m[1]}/${m[2]}` : undefined;
}
