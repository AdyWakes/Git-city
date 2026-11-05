/**
 * The city file format (`city.json`). Columnar arrays keep it compact: a 10k-building city
 * with full time-lapse data is typically 1-3 MB raw and a fraction of that gzipped.
 *
 * Coordinates are in "cells" (1 cell = smallest building lot). x/z are building centers.
 */
export const FORMAT_VERSION = 1;

export interface CityLang {
  name: string;
  color: string;
}

export interface CityDistrict {
  name: string;
  /** Center and size of the district block. */
  x: number;
  z: number;
  w: number;
  d: number;
  files: number;
  lines: number;
}

export interface CityBuildings {
  path: string[];
  district: number[];
  lang: number[];
  x: number[];
  z: number[];
  /** Square footprint edge length. */
  size: number[];
  /** Lines of code at HEAD (0 for deleted files). */
  lines: number[];
  /** Max lines the file ever had. */
  peak: number[];
  commits: number[];
  /** Index into `authors` of the author with most commits to this file. */
  author: number[];
  /** Tick the file was created. */
  born: number[];
  /** Tick the file was deleted, -1 if alive at HEAD. */
  died: number[];
}

export interface CityData {
  v: typeof FORMAT_VERSION;
  generator: string;
  generatedAt: string;
  repo: { name: string; url?: string; branch?: string; head?: string };
  stats: {
    commits: number;
    authors: number;
    /** Files that ever existed (text files). */
    files: number;
    /** Files alive at HEAD. */
    alive: number;
    /** Buildings in this file (alive + lots). */
    rendered: number;
    /** Total lines across all alive files. */
    lines: number;
    first: number;
    last: number;
  };
  langs: CityLang[];
  authors: { name: string; commits: number }[];
  /** Time-lapse is split into ticks (buckets of consecutive commits). */
  ticks: { t: number[]; n: number[] };
  districts: CityDistrict[];
  b: CityBuildings;
  /** Flat events, sorted by tick: [tick, building, linesAfter, author, ...]. */
  ev: number[];
}
