"use client";

import { cn } from "cn";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

import type { PolicyPreview } from "@/lib/commands/policy";
import type { FieldErrors } from "@/lib/commands/result";
import type { Policy } from "@/lib/policy-schema";
import type { PolicyVersion } from "@/lib/reads/policy";

import { previewPolicyAction, savePolicyAction } from "@/app/actions/policy";
import { formatDateTime } from "@/components/format";
import { PriorityIcon } from "@/components/priority";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatUsd, PRIORITY_LABELS } from "@/lib/labels";
import { TRIAGE_PRIORITIES } from "@/lib/priorities";

// The policy editor (plan M5): thresholds and switches only, never rules
// (ADR-0001). Every change is previewed over every ticket's stored judgment,
// with no model calls: how many tickets move, from what to what. Saving adds
// a version; the worker recomputes and moves exactly the previewed tickets.

type NumberField = {
  path: string;
  label: string;
  help: string;
  step: number;
  get: (policy: Policy) => number;
  set: (policy: Policy, value: number) => Policy;
  format?: (value: number) => string;
};

const FIELDS: { title: string; fields: NumberField[] }[] = [
  {
    title: "Reading Jev's answers",
    fields: [
      {
        path: "yesThreshold",
        label: "Yes at or above",
        help: "A yes/no answer counts as yes from this probability on.",
        step: 0.05,
        get: (p) => p.yesThreshold,
        set: (p, v) => ({ ...p, yesThreshold: v }),
      },
      {
        path: "minDuplicateProbability",
        label: "Link a duplicate from",
        help: "Jev's pick is linked from this probability on; below it, the match counts as ambiguous.",
        step: 0.05,
        get: (p) => p.minDuplicateProbability,
        set: (p, v) => ({ ...p, minDuplicateProbability: v }),
      },
    ],
  },
  {
    title: "Sending tickets to review",
    fields: [
      {
        path: "reviewBand.low",
        label: "Uncertain from",
        help: "A yes/no answer that decided the priority and lies in this band sends the ticket to review.",
        step: 0.05,
        get: (p) => p.reviewBand.low,
        set: (p, v) => ({ ...p, reviewBand: { ...p.reviewBand, low: v } }),
      },
      {
        path: "reviewBand.high",
        label: "Uncertain up to",
        help: "The top of the same band.",
        step: 0.05,
        get: (p) => p.reviewBand.high,
        set: (p, v) => ({ ...p, reviewBand: { ...p.reviewBand, high: v } }),
      },
      {
        path: "minTypeProbability",
        label: "Type sure from",
        help: "Below this probability of the chosen type, the ticket goes to review.",
        step: 0.05,
        get: (p) => p.minTypeProbability,
        set: (p, v) => ({ ...p, minTypeProbability: v }),
      },
      {
        path: "minAreaProbability",
        label: "Area sure from",
        help: "Below this probability of the chosen area, a bug or feature request goes to review.",
        step: 0.05,
        get: (p) => p.minAreaProbability,
        set: (p, v) => ({ ...p, minAreaProbability: v }),
      },
    ],
  },
  {
    title: "Feature demand",
    fields: [
      {
        path: "featureDemand.mediumWorkspaces",
        label: "Medium from workspaces",
        help: "A feature request whose issue this many workspaces asked for is Medium.",
        step: 1,
        get: (p) => p.featureDemand.mediumWorkspaces,
        set: (p, v) => ({ ...p, featureDemand: { ...p.featureDemand, mediumWorkspaces: v } }),
      },
      {
        path: "featureDemand.mediumArr",
        label: "or from ARR",
        help: "…or whose asking workspaces bring this much ARR together.",
        step: 10_000,
        get: (p) => p.featureDemand.mediumArr,
        set: (p, v) => ({ ...p, featureDemand: { ...p.featureDemand, mediumArr: v } }),
        format: formatUsd,
      },
      {
        path: "featureDemand.highWorkspaces",
        label: "High from workspaces",
        help: "The same for High.",
        step: 1,
        get: (p) => p.featureDemand.highWorkspaces,
        set: (p, v) => ({ ...p, featureDemand: { ...p.featureDemand, highWorkspaces: v } }),
      },
      {
        path: "featureDemand.highArr",
        label: "or from ARR",
        help: "…or from this much ARR.",
        step: 10_000,
        get: (p) => p.featureDemand.highArr,
        set: (p, v) => ({ ...p, featureDemand: { ...p.featureDemand, highArr: v } }),
        format: formatUsd,
      },
    ],
  },
];

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "invalid"; errors: FieldErrors }
  | { status: "ready"; preview: PolicyPreview };

export function PolicyEditor({ versions }: { versions: PolicyVersion[] }) {
  const [current] = versions;
  if (!current) return null;
  // A new version remounts the form with its values.
  return <Editor key={current.version} current={current} versions={versions} />;
}

function Editor({ current, versions }: { current: PolicyVersion; versions: PolicyVersion[] }) {
  const [values, setValues] = useState<Policy>(current.values);
  // The latest preview, for the values it was computed from.
  const [computed, setComputed] = useState<{ key: string; state: PreviewState } | null>(null);
  const [saveErrors, setSaveErrors] = useState<FieldErrors>({});
  const [saving, startSaving] = useTransition();
  const key = JSON.stringify(values);
  const changed = key !== JSON.stringify(current.values);
  const preview: PreviewState = !changed
    ? { status: "idle" }
    : computed?.key === key
      ? computed.state
      : { status: "loading" };

  useEffect(() => {
    let stale = false;
    const timer = setTimeout(async () => {
      if (!changed) return;
      const result = await previewPolicyAction(values);
      if (stale) return;
      setComputed({
        key: JSON.stringify(values),
        state: result.ok
          ? { status: "ready", preview: result.preview }
          : { status: "invalid", errors: result.errors },
      });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [values, changed]);

  const errors = preview.status === "invalid" ? preview.errors : saveErrors;
  const save = () =>
    startSaving(async () => {
      const result = await savePolicyAction(values);
      setSaveErrors(result.ok ? {} : result.errors);
    });

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-8">
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          {FIELDS.map((group) => (
            <fieldset key={group.title} className="space-y-3">
              <legend className="mb-2 text-sm font-semibold">{group.title}</legend>
              <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {group.fields.map((field) => (
                  <PolicyNumber
                    key={field.path}
                    field={field}
                    value={field.get(values)}
                    before={field.get(current.values)}
                    errors={errors[field.path]}
                    onChange={(value) => setValues((policy) => field.set(policy, value))}
                  />
                ))}
              </div>
            </fieldset>
          ))}
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">Plans</legend>
            <div className="flex items-center gap-3">
              <Switch
                id="enterpriseRaisesOneLevel"
                checked={values.enterpriseRaisesOneLevel}
                onCheckedChange={(checked) =>
                  setValues((policy) => ({ ...policy, enterpriseRaisesOneLevel: checked }))
                }
              />
              <Label htmlFor="enterpriseRaisesOneLevel">
                Enterprise workspaces go up one level, up to High
              </Label>
            </div>
          </fieldset>
          {errors["(form)"] && (
            <p className="text-sm text-destructive">{errors["(form)"].join(" ")}</p>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!changed || saving || preview.status !== "ready"}>
              Save as version {current.version + 1}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={!changed || saving}
              onClick={() => setValues(current.values)}
            >
              Reset
            </Button>
            {saving && <span className="text-sm text-muted-foreground">Saving…</span>}
          </div>
        </form>
        <Versions versions={versions} onUse={(policy) => setValues(policy)} />
      </div>
      <PreviewPanel state={preview} fromVersion={current.version} />
    </div>
  );
}

function PolicyNumber({
  field,
  value,
  before,
  errors,
  onChange,
}: {
  field: NumberField;
  value: number;
  before: number;
  errors?: string[];
  onChange: (value: number) => void;
}) {
  const id = `policy-${field.path}`;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{field.label}</Label>
      <Input
        id={id}
        type="number"
        step={field.step}
        min={0}
        value={Number.isNaN(value) ? "" : value}
        aria-invalid={errors ? true : undefined}
        aria-describedby={`${id}-help`}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {field.help}
        {value !== before && !Number.isNaN(before) && (
          <> Was {field.format ? field.format(before) : before}.</>
        )}
      </p>
      {errors && <p className="text-xs text-destructive">{errors.join(" ")}</p>}
    </div>
  );
}

function PreviewPanel({ state, fromVersion }: { state: PreviewState; fromVersion: number }) {
  return (
    <aside className="h-fit space-y-4 rounded-lg border p-4 xl:sticky xl:top-4" aria-live="polite">
      <h2 className="text-sm font-semibold">Preview</h2>
      {state.status === "idle" && (
        <p className="text-sm text-muted-foreground">
          Change a value to see which tickets it would move. The preview runs the policy over every
          ticket's stored judgment, without asking Jev again.
        </p>
      )}
      {state.status === "loading" && <p className="text-sm text-muted-foreground">Computing…</p>}
      {state.status === "invalid" && (
        <p className="text-sm text-destructive">Fix the highlighted fields to see a preview.</p>
      )}
      {state.status === "ready" && <Moves preview={state.preview} fromVersion={fromVersion} />}
    </aside>
  );
}

function Moves({ preview, fromVersion }: { preview: PolicyPreview; fromVersion: number }) {
  const shown = TRIAGE_PRIORITIES.filter((priority) =>
    TRIAGE_PRIORITIES.some(
      (other) => preview.matrix[priority][other] > 0 || preview.matrix[other][priority] > 0,
    ),
  );
  return (
    <div className="space-y-4">
      <p className="text-2xl font-semibold tabular-nums">
        Moves {preview.movedCount} ticket{preview.movedCount === 1 ? "" : "s"}
      </p>
      <p className="text-xs text-muted-foreground">
        Compared with v{fromVersion} over {preview.compared} tickets the policy decides;{" "}
        {preview.skippedHumanSet} with a person's priority stay as they are.
      </p>
      <table className="w-full text-xs tabular-nums">
        <caption className="mb-1 text-left text-muted-foreground">
          Rows: now. Columns: after saving.
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Now</span>
            </th>
            {shown.map((priority) => (
              <th
                key={priority}
                scope="col"
                className="p-1 font-normal"
                title={PRIORITY_LABELS[priority]}
              >
                <PriorityIcon priority={priority} className="mx-auto" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((from) => (
            <tr key={from}>
              <th scope="row" className="p-1 text-left font-normal">
                {PRIORITY_LABELS[from]}
              </th>
              {shown.map((to) => {
                const count = preview.matrix[from][to];
                return (
                  <td
                    key={to}
                    className={cn(
                      "p-1 text-center",
                      from === to
                        ? "text-muted-foreground"
                        : count > 0 && "bg-amber-100 font-semibold dark:bg-amber-900",
                    )}
                  >
                    {count || "·"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {preview.samples.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Some of the tickets that move:</p>
          <ul className="space-y-1 text-xs">
            {preview.samples.map((sample) => (
              <li key={sample.ticketId} className="flex items-center gap-1.5">
                <PriorityIcon priority={sample.from} className="size-3.5" />
                <ArrowRight className="size-3 text-muted-foreground" />
                <PriorityIcon priority={sample.to} className="size-3.5" />
                <Link href={`/inbox?t=${sample.ticketId}`} className="truncate hover:underline">
                  {sample.subject}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Versions({
  versions,
  onUse,
}: {
  versions: PolicyVersion[];
  onUse: (policy: Policy) => void;
}) {
  return (
    <section aria-labelledby="versions" className="space-y-2">
      <h2 id="versions" className="text-sm font-semibold">
        Versions
      </h2>
      <p className="text-xs text-muted-foreground">
        Saved versions never change. The newest is in force; an older one can be loaded into the
        form and saved again as a new version.
      </p>
      <ul className="divide-y rounded-lg border text-sm">
        {versions.map((version, index) => {
          const older = versions[index + 1];
          const changes = older ? changedFields(older.values, version.values) : [];
          return (
            <li key={version.version} className="flex items-start justify-between gap-3 px-3 py-2">
              <div>
                <p>
                  <span className="font-medium">v{version.version}</span>
                  {index === 0 && <span className="ml-2 text-xs text-emerald-700">in force</span>}
                  <span className="ml-2 text-xs text-muted-foreground" suppressHydrationWarning>
                    {formatDateTime(version.createdAt)}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {older
                    ? changes.length > 0
                      ? `Changed ${changes.join(", ")}`
                      : "Same values as the version before"
                    : "The default policy"}
                </p>
              </div>
              {index > 0 && (
                <Button variant="outline" size="xs" onClick={() => onUse(version.values)}>
                  Load
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function changedFields(before: Policy, after: Policy): string[] {
  const all = FIELDS.flatMap(({ fields }) => fields);
  const names = all
    .filter((field) => field.get(before) !== field.get(after))
    .map((field) => `${field.label.toLowerCase()} ${field.get(before)} → ${field.get(after)}`);
  if (before.enterpriseRaisesOneLevel !== after.enterpriseRaisesOneLevel) {
    names.push(`Enterprise raise ${after.enterpriseRaisesOneLevel ? "on" : "off"}`);
  }
  return names;
}
