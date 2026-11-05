export interface CliArgs {
  target: string;
  port: number;
  host: string;
  open: boolean;
  maxBuildings: number;
  json?: string;
  keep: boolean;
  help: boolean;
  version: boolean;
}

export class ArgError extends Error {}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { target: '.', port: 4173, host: '127.0.0.1', open: true, maxBuildings: 10000, keep: false, help: false, version: false };
  let positional: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const [flag, inline] = raw.startsWith('--') && raw.includes('=') ? [raw.slice(0, raw.indexOf('=')), raw.slice(raw.indexOf('=') + 1)] : [raw, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || (inline === undefined && v.startsWith('-'))) throw new ArgError(`${flag} needs a value`);
      return v;
    };
    const int = (min: number) => {
      const v = Number(value());
      if (!Number.isInteger(v) || v < min) throw new ArgError(`${flag} must be an integer >= ${min}`);
      return v;
    };
    switch (flag) {
      case '-h':
      case '--help':
        out.help = true;
        break;
      case '-v':
      case '--version':
        out.version = true;
        break;
      case '-p':
      case '--port':
        out.port = int(0);
        break;
      case '--host':
        out.host = value();
        break;
      case '-n':
      case '--max-buildings':
        out.maxBuildings = int(1);
        break;
      case '--no-open':
        out.open = false;
        break;
      case '--json':
        out.json = value();
        break;
      case '--keep':
        out.keep = true;
        break;
      default:
        if (flag.startsWith('-')) throw new ArgError(`Unknown option ${flag}`);
        if (positional !== undefined) throw new ArgError(`Unexpected argument ${flag}`);
        positional = flag;
    }
  }
  if (positional) out.target = positional;
  return out;
}

export const HELP = `
gitcity — your git history as a 3D night city

Usage
  npx gitcity                       current folder's repository
  npx gitcity ./path/to/repo        a local repository
  npx gitcity https://github.com/user/repo
                                    clones to a temp folder first (full clone)

Options
  -n, --max-buildings <n>   render the largest n files (default 10000)
  -p, --port <port>         port for the local viewer (default 4173, next free one is used)
      --host <host>         interface to bind (default 127.0.0.1)
      --no-open             do not open the browser
      --json <file>         write the city data to a file and exit (no server)
      --keep                keep the temporary clone of a remote repository
  -h, --help                show this help
  -v, --version             print the version

Nothing leaves your machine: no telemetry, no network calls except the optional clone.
`;
