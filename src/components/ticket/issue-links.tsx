"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Link2, Plus, Unlink } from "lucide-react";
import { useState, useTransition } from "react";

import type { TicketDetail } from "@/lib/reads/ticket";

import { createIssueAction, linkIssueAction, unlinkIssueAction } from "@/app/actions/tickets";
import { useIssueSearch } from "@/components/queries";
import { ProbabilityBar } from "@/components/ticket/why-priority";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { defaultIssueTitle, ISSUE_TITLE_MAX_CHARS } from "@/lib/config/issues";
import { formatUsd } from "@/lib/labels";
import { percent } from "@/lib/triage/explain";

// Duplicates (plan M5): the issues the ticket is linked to and their demand,
// the candidates Jev chose from, a search to link any other issue of the
// tracker, and "Create issue" with the subject as an editable title.

const SHOWN_CANDIDATES = 5;

export function IssueLinks({ detail }: { detail: TicketDetail }) {
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const linked = new Set(detail.links.map(({ issueId }) => issueId));
  const demand = new Map(detail.demand.map((each) => [each.issueId, each]));

  const run = (action: () => Promise<{ ok: boolean; errors?: Record<string, string[]> }>) =>
    startTransition(async () => {
      const result = await action();
      setError(
        result.ok
          ? null
          : Object.values(result.errors ?? {})
              .flat()
              .join(" "),
      );
      await queryClient.invalidateQueries({ queryKey: ["ticket", detail.id] });
      await queryClient.invalidateQueries({ queryKey: ["tickets"] });
    });

  return (
    <section aria-labelledby="duplicates" className="space-y-3">
      <h3 id="duplicates" className="text-sm font-semibold">
        Duplicate of
      </h3>
      {detail.links.length === 0 ? (
        <p className="text-sm text-muted-foreground">Not linked to an existing issue.</p>
      ) : (
        <ul className="space-y-2">
          {detail.links.map((link) => {
            const each = demand.get(link.issueId);
            return (
              <li key={link.issueId} className="rounded-md border px-3 py-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-xs">{link.issueId}</span> {link.title}
                    <Badge variant="outline" className="ml-2">
                      {link.origin === "jev" ? "Linked by Jev" : "Linked by a person"}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Unlink ${link.issueId}`}
                    disabled={pending}
                    onClick={() => run(() => unlinkIssueAction(detail.id, link.issueId))}
                  >
                    <Unlink />
                  </Button>
                </div>
                {each && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Demand: {each.tickets} tickets from {each.workspaces} workspaces,{" "}
                    {formatUsd(each.arr)} ARR
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {detail.candidates.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Jev's candidates
            {detail.noneProbability !== null &&
              `; none of them: ${percent(detail.noneProbability)}`}
          </p>
          <ul className="space-y-1">
            {detail.candidates.slice(0, SHOWN_CANDIDATES).map((candidate) => (
              <li
                key={candidate.issueId}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-xs"
              >
                <span className="truncate">
                  <span className="font-mono">{candidate.issueId}</span> {candidate.title}
                </span>
                <ProbabilityBar probability={candidate.probability} />
                <Button
                  variant="outline"
                  size="xs"
                  disabled={pending || linked.has(candidate.issueId)}
                  onClick={() => run(() => linkIssueAction(detail.id, candidate.issueId))}
                >
                  <Link2 /> Link
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <IssueSearch
        tracker={detail.workspace.tracker}
        linked={linked}
        disabled={pending}
        onLink={(issueId) => run(() => linkIssueAction(detail.id, issueId))}
      />
      <CreateIssue
        key={detail.id}
        subject={detail.subject}
        disabled={pending}
        onCreate={(title) => run(() => createIssueAction(detail.id, title))}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  );
}

function IssueSearch({
  tracker,
  linked,
  disabled,
  onLink,
}: {
  tracker: string;
  linked: ReadonlySet<string>;
  disabled: boolean;
  onLink: (issueId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const { data: issues = [] } = useIssueSearch(tracker, query.trim());
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Link another {tracker} issue
      </summary>
      <div className="mt-2 space-y-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search titles or ids"
          aria-label={`Search ${tracker} issues`}
        />
        <ul className="space-y-1">
          {issues.map((issue) => (
            <li key={issue.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">
                <span className="font-mono">{issue.id}</span> {issue.title}
              </span>
              <Button
                variant="outline"
                size="xs"
                disabled={disabled || linked.has(issue.id)}
                onClick={() => onLink(issue.id)}
              >
                <Link2 /> Link
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function CreateIssue({
  subject,
  disabled,
  onCreate,
}: {
  subject: string;
  disabled: boolean;
  onCreate: (title: string) => void;
}) {
  const [title, setTitle] = useState(defaultIssueTitle(subject));
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Create a new issue from this ticket
      </summary>
      <form
        className="mt-2 space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(title);
        }}
      >
        <Input
          value={title}
          maxLength={ISSUE_TITLE_MAX_CHARS}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="Issue title"
        />
        <p className="text-xs text-muted-foreground">
          The body is the customer's first message, copied as it is.
        </p>
        <Button type="submit" size="sm" disabled={disabled || title.trim() === ""}>
          <Plus /> Create and link
        </Button>
      </form>
    </details>
  );
}
