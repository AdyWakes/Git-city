/**
 * Curated night palette: twelve jewel tones with similar lightness so no language shouts.
 * They tint the building walls; warm window light does the rest.
 */
export const PALETTE = {
  blue: '#5b7cfa',
  teal: '#2fb5a3',
  violet: '#8e6cf0',
  magenta: '#c7509b',
  coral: '#e8735f',
  amber: '#e0a43a',
  sage: '#8fb35a',
  sky: '#4fb0e0',
  plum: '#a2569e',
  sand: '#c9a77c',
  slate: '#7d8aa8',
  rose: '#e0607a',
} as const;

type Color = keyof typeof PALETTE;

const LANGS: [name: string, color: Color, exts: string[]][] = [
  ['TypeScript', 'blue', ['ts', 'tsx', 'mts', 'cts']],
  ['JavaScript', 'amber', ['js', 'jsx', 'mjs', 'cjs']],
  ['Python', 'teal', ['py', 'pyi', 'pyx', 'ipynb']],
  ['Go', 'sky', ['go']],
  ['Rust', 'coral', ['rs']],
  ['Java', 'rose', ['java']],
  ['Kotlin', 'violet', ['kt', 'kts']],
  ['C', 'slate', ['c', 'h']],
  ['C++', 'plum', ['cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx', 'ino']],
  ['C#', 'violet', ['cs']],
  ['Swift', 'coral', ['swift']],
  ['Objective-C', 'plum', ['m', 'mm']],
  ['Ruby', 'magenta', ['rb', 'erb', 'rake', 'gemspec']],
  ['PHP', 'violet', ['php']],
  ['Scala', 'rose', ['scala', 'sc']],
  ['Elixir', 'plum', ['ex', 'exs']],
  ['Erlang', 'magenta', ['erl', 'hrl']],
  ['Haskell', 'violet', ['hs']],
  ['Lua', 'sky', ['lua']],
  ['Dart', 'sky', ['dart']],
  ['Zig', 'amber', ['zig']],
  ['Vue', 'sage', ['vue']],
  ['Svelte', 'coral', ['svelte']],
  ['HTML', 'rose', ['html', 'htm', 'xhtml', 'hbs', 'ejs', 'pug', 'jade']],
  ['CSS', 'magenta', ['css', 'scss', 'sass', 'less', 'styl']],
  ['Shell', 'sage', ['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd']],
  ['Markdown', 'sand', ['md', 'mdx', 'markdown', 'rst', 'txt', 'adoc', 'rdoc', 'tex']],
  ['Config', 'slate', ['json', 'json5', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'xml', 'lock', 'properties', 'env', 'gradle']],
  ['SQL', 'teal', ['sql']],
];

const SPECIAL: Record<string, string> = {
  makefile: 'Shell',
  dockerfile: 'Shell',
  rakefile: 'Ruby',
  gemfile: 'Ruby',
  'cmakelists.txt': 'C++',
  license: 'Markdown',
  readme: 'Markdown',
  changelog: 'Markdown',
  authors: 'Markdown',
};

const BY_EXT = new Map<string, string>();
const COLOR = new Map<string, string>();
for (const [name, color, exts] of LANGS) {
  COLOR.set(name, PALETTE[color]);
  for (const e of exts) BY_EXT.set(e, name);
}
export const OTHER = 'Other';
COLOR.set(OTHER, '#6b7286');

export function languageOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const special = SPECIAL[base];
  if (special) return special;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return OTHER;
  return BY_EXT.get(base.slice(dot + 1)) ?? OTHER;
}

export function languageColor(name: string): string {
  return COLOR.get(name) ?? COLOR.get(OTHER)!;
}
