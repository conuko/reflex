import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

// Runs scripts/check-terms.ts against throwaway git repos. The terms here are
// fictional stand-ins; the real ones never enter the repo.

const repoRoot = resolve(import.meta.dirname, "../..");
const terms = "Globex Corporation\ninitech\n";

const repos: string[] = [];

afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("check:terms", () => {
  it("passes when no tracked file or commit message has a term", () => {
    const repo = makeRepo();
    write(repo, ".forbidden-terms", terms);

    const result = checkTerms(repo);

    expect(result.status).toBe(0);
  });

  it("fails when a tracked file has a term, in any case, and names the file and line", () => {
    const repo = makeRepo();
    write(repo, ".forbidden-terms", terms);
    write(repo, "src/notes.md", "# Notes\n\nBuilt for GLOBEX corporation.\n");
    git(repo, "add", "src/notes.md");

    const result = checkTerms(repo);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/notes.md:3");
  });

  it("does not print the term it found", () => {
    const repo = makeRepo();
    write(repo, ".forbidden-terms", terms);
    write(repo, "notes.md", "Built for Initech.\n");
    git(repo, "add", "notes.md");

    const result = checkTerms(repo);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`.toLowerCase()).not.toContain("initech");
  });

  it("fails when a tracked file's name has a term", () => {
    const repo = makeRepo();
    write(repo, ".forbidden-terms", terms);
    write(repo, "docs/initech-onboarding.md", "Onboarding\n");
    git(repo, "add", "docs");

    const result = checkTerms(repo);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("docs/");
  });

  it("fails when a tracked gzipped file has a term", () => {
    const repo = makeRepo();
    write(repo, ".forbidden-terms", terms);
    write(repo, "data/raw/page-0001.json.gz", gzipSync('{"body":"We use Initech"}'));
    git(repo, "add", "data");

    const result = checkTerms(repo);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("data/raw/page-0001.json.gz");
  });

  it("ignores untracked files", () => {
    const repo = makeRepo();
    write(repo, ".forbidden-terms", terms);
    write(repo, "scratch.md", "Initech\n");

    const result = checkTerms(repo);

    expect(result.status).toBe(0);
  });

  it("fails when a commit message has a term", () => {
    const repo = makeRepo();
    write(repo, ".forbidden-terms", terms);
    write(repo, "README.md", "Reflex triages tickets.\n");
    git(repo, "commit", "-q", "-am", "docs: explain the Globex Corporation setup");

    const result = checkTerms(repo);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/commit [0-9a-f]{7,}/);
  });

  it("reads the terms from FORBIDDEN_TERMS when .forbidden-terms is missing", () => {
    const repo = makeRepo();
    write(repo, "notes.md", "Built for Initech.\n");
    git(repo, "add", "notes.md");

    const result = checkTerms(repo, { FORBIDDEN_TERMS: terms });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("notes.md:1");
  });

  it("fails closed when neither .forbidden-terms nor FORBIDDEN_TERMS exists", () => {
    const repo = makeRepo();

    const result = checkTerms(repo);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".forbidden-terms");
    expect(result.stderr).toContain("FORBIDDEN_TERMS");
  });

  it("fails closed when the term source has no terms", () => {
    const repo = makeRepo();
    write(repo, ".forbidden-terms", "\n  \n");

    const result = checkTerms(repo, { FORBIDDEN_TERMS: "" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(".forbidden-terms");
  });
});

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "reflex-terms-"));
  repos.push(dir);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "commit.gpgsign", "false");
  write(dir, "README.md", "Reflex\n");
  git(dir, "add", "README.md");
  git(dir, "commit", "-q", "-m", "chore: initial commit");
  return dir;
}

function write(repo: string, file: string, content: string | Buffer) {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), content);
}

function git(repo: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

function checkTerms(repo: string, env: Record<string, string> = {}) {
  const { FORBIDDEN_TERMS: _ignored, ...inherited } = process.env;
  return spawnSync(
    join(repoRoot, "node_modules/.bin/tsx"),
    [join(repoRoot, "scripts/check-terms.ts")],
    { cwd: repo, encoding: "utf8", env: { ...inherited, ...env } },
  );
}
