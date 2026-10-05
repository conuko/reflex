import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

// oxlint skips ignored paths even when passed explicitly, so an in-repo fixture
// can't prove the boundary. Instead, lint probe files in a temp dir that holds a
// copy of the repo's config.

const repoRoot = resolve(import.meta.dirname, "../..");

const lintOutput = z.object({
  diagnostics: z.array(
    z.object({ code: z.string(), help: z.string().optional(), filename: z.string() }),
  ),
});

type Diagnostic = z.infer<typeof lintOutput>["diagnostics"][number];

const blocked = [
  "src/lib/next.ts:next",
  "src/lib/next-server.ts:next/server",
  "src/lib/next-deep.ts:next/dist/server/web/spec-extension/request",
  "src/lib/react.ts:react",
  "src/lib/react-jsx.ts:react/jsx-runtime",
  "src/lib/react-dom.ts:react-dom",
  "src/lib/react-dom-client.ts:react-dom/client",
  "src/lib/server-only.ts:server-only",
  "src/lib/alias-app.ts:@/app/page",
  "src/lib/alias-components.ts:@/components/ui/button",
  "src/lib/alias-server.ts:@/server/db",
  "src/lib/relative-app.ts:../app/page",
  "src/lib/nested/relative-components.ts:../../components/ui/button",
  "src/lib/relative-server.ts:../server/db",
  "src/worker/next-server.ts:next/server",
  "src/worker/processors/alias-server.ts:@/server/db",
].map(parseProbe);

const allowed = [
  "src/lib/zod.ts:zod",
  "src/lib/alias-lib.ts:@/lib/env",
  "src/lib/sibling.ts:./env",
  "src/app/next-server.ts:next/server",
  "src/server/server-only.ts:server-only",
].map(parseProbe);

const unassignedServerOnly = "src/server/unassigned.ts";

let dir: string;
let status: number | null;
let diagnostics: Diagnostic[];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "reflex-lint-"));
  copyFileSync(join(repoRoot, ".oxlintrc.json"), join(dir, ".oxlintrc.json"));
  for (const { file, specifier } of [...blocked, ...allowed]) {
    mkdirSync(join(dir, dirname(file)), { recursive: true });
    writeFileSync(join(dir, file), `import * as probe from "${specifier}";\n\nexport { probe };\n`);
  }

  const result = spawnSync(join(repoRoot, "node_modules/.bin/oxlint"), ["--format=json"], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      OXLINT_TSGOLINT_PATH: join(repoRoot, "node_modules/.bin/tsgolint"),
    },
  });
  status = result.status;
  diagnostics = lintOutput.parse(JSON.parse(result.stdout)).diagnostics;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("framework-free boundary for src/lib and src/worker", () => {
  it("fails the lint run", () => {
    expect(status).toBe(1);
  });

  it.each(blocked)("blocks $specifier in $file, with a message", ({ file }) => {
    const restricted = restrictedImportsIn(file);

    expect(restricted).not.toEqual([]);
    expect(restricted.map((d) => d.help ?? "")).not.toContain("");
  });

  it.each(allowed)("allows $specifier in $file", ({ file }) => {
    expect(restrictedImportsIn(file)).toEqual([]);
  });
});

describe("server-only", () => {
  it("can be imported for its side effect without a warning", () => {
    expect(diagnostics.filter((d) => d.filename === unassignedServerOnly)).toEqual([]);
  });
});

function parseProbe(entry: string) {
  const [file = "", specifier = ""] = entry.split(/:(.*)/);
  return { file, specifier };
}

function restrictedImportsIn(file: string): Diagnostic[] {
  return diagnostics.filter(
    (d) => d.filename === file && d.code === "eslint(no-restricted-imports)",
  );
}
