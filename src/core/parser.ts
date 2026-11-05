/**
 * Streaming parser for `git log -z --raw --numstat` output.
 *
 * The parser never holds more than one commit (plus one partial token) in memory, so it can
 * consume the history of very large repositories chunk by chunk straight from git's stdout.
 *
 * Expected command (see `GIT_LOG_ARGS`):
 *   git log --reverse -M --raw --numstat --no-abbrev -z --format=<RS>%H<US>%at<US>%aN<US>%aE
 *
 * With `-z` every token is NUL-terminated and paths are emitted verbatim (no C-quoting), which
 * makes unusual filenames (spaces, tabs, unicode, `=>`) safe to parse.
 *
 * Per commit the output looks like:
 *   \x1e<hash>\x1f<time>\x1f<name>\x1f<email>\0
 *   \n:<modes> <shas> <STATUS>\0<path>\0          (raw, one per change; R/C carry two paths)
 *   <added>\t<deleted>\t<path>\0                  (numstat; renames: "a\td\t\0old\0new\0")
 */

export const RS = '\x1e';
export const US = '\x1f';

export const GIT_LOG_ARGS = [
  '-c',
  'core.quotepath=off',
  'log',
  '--reverse',
  '-M',
  '--raw',
  '--numstat',
  '--no-abbrev',
  '--no-color',
  '-z',
  `--format=${'%x1e'}%H%x1f%at%x1f%aN%x1f%aE`,
];

export type ChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X';

export interface FileChange {
  /** Path after the commit (for deletes: the deleted path). */
  path: string;
  /** Previous path for renames/copies. */
  oldPath?: string;
  status: ChangeStatus;
  added: number;
  deleted: number;
  binary: boolean;
}

export interface Commit {
  hash: string;
  /** Unix seconds (author time). */
  time: number;
  author: string;
  email: string;
  changes: FileChange[];
}

type Pending =
  | { kind: 'none' }
  | { kind: 'raw1'; status: ChangeStatus }
  | { kind: 'raw2a'; status: ChangeStatus }
  | { kind: 'raw2b'; status: ChangeStatus; oldPath: string }
  | { kind: 'num2a'; added: number; deleted: number; binary: boolean }
  | { kind: 'num2b'; added: number; deleted: number; binary: boolean; oldPath: string };

interface NumEntry {
  added: number;
  deleted: number;
  binary: boolean;
}

/**
 * Incremental parser. Feed it strings with `write()`, call `end()` when the stream is done.
 * `onCommit` is invoked once per commit, in stream order.
 */
export class GitLogParser {
  private buf = '';
  private current: {
    hash: string;
    time: number;
    author: string;
    email: string;
    raw: { status: ChangeStatus; path: string; oldPath?: string }[];
    num: Map<string, NumEntry>;
  } | null = null;
  private pending: Pending = { kind: 'none' };
  /** Set while reading the path of a raw entry that must be ignored (submodules). */
  private skipNext = false;
  private skipped = new Set<string>();
  /** Number of commits emitted so far. */
  count = 0;

  constructor(private readonly onCommit: (c: Commit) => void) {}

  write(chunk: string): void {
    this.buf += chunk;
    let start = 0;
    for (;;) {
      const nul = this.buf.indexOf('\0', start);
      if (nul === -1) break;
      this.token(this.buf.slice(start, nul));
      start = nul + 1;
    }
    this.buf = start === 0 ? this.buf : this.buf.slice(start);
  }

  end(): void {
    if (this.buf.length > 0) {
      // A trailing token without NUL (e.g. a header of a last empty commit).
      this.token(this.buf);
      this.buf = '';
    }
    this.flush();
  }

  private token(tok: string): void {
    const p = this.pending;
    if (p.kind !== 'none') {
      // Path tokens are verbatim; never strip them.
      this.pending = { kind: 'none' };
      switch (p.kind) {
        case 'raw1':
          if (this.skipNext) {
            this.skipNext = false;
            this.skipped.add(tok);
          } else this.current?.raw.push({ status: p.status, path: tok });
          return;
        case 'raw2a':
          this.pending = { kind: 'raw2b', status: p.status, oldPath: tok };
          return;
        case 'raw2b':
          if (this.skipNext) {
            this.skipNext = false;
            this.skipped.add(tok);
          } else this.current?.raw.push({ status: p.status, path: tok, oldPath: p.oldPath });
          return;
        case 'num2a':
          this.pending = { kind: 'num2b', added: p.added, deleted: p.deleted, binary: p.binary, oldPath: tok };
          return;
        case 'num2b':
          this.current?.num.set(tok, { added: p.added, deleted: p.deleted, binary: p.binary });
          return;
      }
    }

    // Structural tokens may be preceded by the newline git prints after a header.
    let t = tok;
    while (t.charCodeAt(0) === 10) t = t.slice(1);
    if (t.length === 0) return;

    const rs = t.indexOf(RS);
    if (rs !== -1) {
      this.flush();
      const f = t.slice(rs + 1).split(US);
      this.current = {
        hash: f[0] ?? '',
        time: Number(f[1]) || 0,
        author: f[2] ?? '',
        email: (f[3] ?? '').trim(),
        raw: [],
        num: new Map(),
      };
      return;
    }

    if (t.charCodeAt(0) === 58 /* ':' */) {
      // ":100644 100644 <sha> <sha> M" (status may carry a score: R087)
      const sp = t.lastIndexOf(' ');
      const status = (t.charAt(sp + 1) || 'M') as ChangeStatus;
      // Submodules (gitlinks, mode 160000) are not files: consume their path(s) and drop them.
      const gitlink = t.startsWith(':160000') || t.slice(8, 14) === '160000';
      this.pending = status === 'R' || status === 'C' ? { kind: 'raw2a', status } : { kind: 'raw1', status };
      if (gitlink) this.skipNext = true;
      return;
    }

    const tab1 = t.indexOf('\t');
    const tab2 = tab1 === -1 ? -1 : t.indexOf('\t', tab1 + 1);
    if (tab2 !== -1) {
      const a = t.slice(0, tab1);
      const d = t.slice(tab1 + 1, tab2);
      const binary = a === '-' || d === '-';
      const added = binary ? 0 : Number(a) || 0;
      const deleted = binary ? 0 : Number(d) || 0;
      const path = t.slice(tab2 + 1);
      if (path.length === 0) {
        this.pending = { kind: 'num2a', added, deleted, binary };
      } else {
        this.current?.num.set(path, { added, deleted, binary });
      }
    }
    // Anything else (warnings, stray summary lines) is ignored.
  }

  private flush(): void {
    const c = this.current;
    if (!c) return;
    this.current = null;
    const changes: FileChange[] = [];
    const seen = new Set<string>();
    for (const r of c.raw) {
      const n = c.num.get(r.path);
      seen.add(r.path);
      changes.push({
        path: r.path,
        oldPath: r.oldPath,
        status: r.status,
        added: n?.added ?? 0,
        deleted: n?.deleted ?? 0,
        binary: n?.binary ?? false,
      });
    }
    // Numstat entries without a raw counterpart (should not happen, but be lenient).
    for (const [path, n] of c.num) {
      if (seen.has(path) || this.skipped.has(path)) continue;
      changes.push({ path, status: 'M', added: n.added, deleted: n.deleted, binary: n.binary });
    }
    this.skipped.clear();
    this.count++;
    this.onCommit({ hash: c.hash, time: c.time, author: c.author, email: c.email, changes });
  }
}

/** Convenience: parse a complete log string (used by tests). */
export function parseGitLog(text: string): Commit[] {
  const out: Commit[] = [];
  const p = new GitLogParser((c) => out.push(c));
  p.write(text);
  p.end();
  return out;
}
