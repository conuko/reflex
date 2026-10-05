// Placeholder for a package script whose milestone hasn't landed yet.
// Usage: tsx scripts/pending.ts <milestone> [--warn-only]
// Milestones are defined in docs/plans/reflex-implementation-plan.md.
// Fails unless --warn-only is passed, so a stub never looks like a success.

const [milestone = "?", ...flags] = process.argv.slice(2);
const script = process.env.npm_lifecycle_event ?? "this script";
const warnOnly = flags.includes("--warn-only");

console.warn(
  `${script}: not implemented yet, lands in milestone ${milestone}${warnOnly ? " (skipped)" : ""}`,
);
process.exitCode = warnOnly ? 0 : 1;
