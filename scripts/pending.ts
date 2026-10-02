// Placeholder for a package script whose ticket hasn't landed yet.
// Usage: tsx scripts/pending.ts <ticket> [--warn-only]
// Fails unless --warn-only is passed, so a stub never looks like a success.

const [ticket = "?", ...flags] = process.argv.slice(2);
const script = process.env.npm_lifecycle_event ?? "this script";
const warnOnly = flags.includes("--warn-only");

console.warn(
  `${script}: not implemented yet, lands in ticket ${ticket}${warnOnly ? " (skipped)" : ""}`,
);
process.exitCode = warnOnly ? 0 : 1;
