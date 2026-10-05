// Fails if a forbidden term appears in a tracked file (its path or its
// contents, gzipped files included) or in a commit message reachable from HEAD.
// Terms come from the gitignored `.forbidden-terms` file (one per line) or,
// when that file is missing, from the FORBIDDEN_TERMS secret in CI, so the
// terms themselves never enter the repo. With neither, the check fails closed.
// Findings name the location and the term's number, never the term itself.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

type Match = { term: number; line: number };

const TERMS_FILE = ".forbidden-terms";

// Run from the repo root, so `git ls-files` lists every tracked file.
const root = git("rev-parse", "--show-toplevel").trim();
process.chdir(root);
const { terms, from } = loadTerms();

if (terms.length === 0) {
  console.error(
    `check:terms: no forbidden terms. Add them to ${TERMS_FILE} (one per line), ` +
      "or set the FORBIDDEN_TERMS secret in CI.",
  );
  process.exit(1);
}

const files = git("ls-files", "-z").split("\0").filter(Boolean);
const commits = hasHead() ? git("log", "-z", "--format=%H%n%B").split("\0").filter(Boolean) : [];

const findings = [
  ...files.flatMap((file) => [
    ...findTerms(file).map(({ term }) => `${file}: path has term #${term}`),
    ...findTerms(readTracked(file)).map(({ term, line }) => `${file}:${line}: term #${term}`),
  ]),
  ...commits.flatMap((entry) => {
    const sha = entry.slice(0, entry.indexOf("\n"));
    const message = entry.slice(sha.length + 1);
    return findTerms(message).map(
      ({ term }) => `commit ${sha.slice(0, 12)}: message has term #${term}`,
    );
  }),
];

if (findings.length > 0) {
  console.error(`check:terms: forbidden terms (from ${from}) found in:`);
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log(
  `check:terms: ${files.length} tracked files and ${commits.length} commit messages are free ` +
    `of the ${terms.length} terms from ${from}.`,
);

function loadTerms(): { terms: string[]; from: string } {
  const file = join(root, TERMS_FILE);
  if (existsSync(file)) return { terms: parseTerms(readFileSync(file, "utf8")), from: TERMS_FILE };
  return { terms: parseTerms(process.env.FORBIDDEN_TERMS ?? ""), from: "FORBIDDEN_TERMS" };
}

function parseTerms(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
}

// The first match of each term, case-insensitive. Term numbers are 1-based.
function findTerms(text: string): Match[] {
  const haystack = text.toLowerCase();
  return terms.flatMap((term, index) => {
    const at = haystack.indexOf(term);
    if (at === -1) return [];
    return [{ term: index + 1, line: haystack.slice(0, at).split("\n").length }];
  });
}

function readTracked(file: string): string {
  const path = join(root, file);
  // A deleted file, a symlink or a submodule has no contents of its own.
  if (!existsSync(path) || !lstatSync(path).isFile()) return "";
  const bytes = readFileSync(path);
  if (!file.endsWith(".gz")) return bytes.toString("utf8");
  try {
    return gunzipSync(bytes).toString("utf8");
  } catch {
    return bytes.toString("utf8");
  }
}

function hasHead(): boolean {
  try {
    git("rev-parse", "--verify", "--quiet", "HEAD");
    return true;
  } catch {
    return false;
  }
}

function git(...args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
