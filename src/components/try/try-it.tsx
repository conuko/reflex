"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Siren } from "lucide-react";
import { useState, useTransition } from "react";

import type { FieldErrors } from "@/lib/commands/result";
import type { WorkspaceOption } from "@/lib/reads/lookups";
import type { TicketDetail } from "@/lib/reads/ticket";

import {
  addTryItReplyAction,
  simulateIncidentAction,
  submitTryItAction,
} from "@/app/actions/try-it";
import { useTicket } from "@/components/queries";
import { TicketPanel } from "@/components/ticket/ticket-panel";
import { useTicketActions } from "@/components/ticket/use-ticket-actions";
import { SignalDiff } from "@/components/try/signal-diff";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TRY_IT_MAX_CHARS } from "@/lib/config/try-it";
import { formatUsd, PLAN_LABELS } from "@/lib/labels";

// Try it (plan M5): paste a ticket, pick a workspace, and watch Jev's
// judgment and the policy's priority arrive. A reply re-triages the thread
// and shows which of Jev's answers moved. Everything goes through the same
// intake and worker as any other ticket.

export function TryIt({
  workspaces,
  initialTicket,
}: {
  workspaces: WorkspaceOption[];
  initialTicket?: TicketDetail;
}) {
  const [ticketId, setTicketId] = useState<string | null>(initialTicket?.id ?? null);
  const { data: detail } = useTicket(ticketId, initialTicket);
  const actions = useTicketActions();

  const show = (id: string) => {
    setTicketId(id);
    window.history.replaceState(null, "", `?t=${encodeURIComponent(id)}`);
  };

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <div className="space-y-8">
        <NewTicket workspaces={workspaces} onCreated={show} />
        <SimulateIncident />
      </div>
      <div className="min-w-0">
        {detail ? (
          <div className="rounded-lg border">
            <TicketPanel
              detail={detail}
              onSetPriority={(priority) => void actions.setPriority(detail.id, priority)}
              onAccept={() => void actions.accept(detail.id)}
              extra={
                <>
                  <SignalDiff detail={detail} />
                  {detail.source === "try_it" && <Reply key={detail.id} detail={detail} />}
                </>
              }
            />
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
            The triage appears here. With <code>pnpm worker</code> running on Jev, it takes about a
            second; on the fake provider, the answers are made up.
          </p>
        )}
      </div>
    </div>
  );
}

function NewTicket({
  workspaces,
  onCreated,
}: {
  workspaces: WorkspaceOption[];
  onCreated: (ticketId: string) => void;
}) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const used = subject.trim().length + text.trim().length;
  const workspace = workspaces.find(({ id }) => id === workspaceId);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await submitTryItAction({ workspaceId, subject, text });
          if (result.ok) {
            setErrors({});
            setSubject("");
            setText("");
            onCreated(result.ticketId);
          } else {
            setErrors(result.errors);
          }
        });
      }}
    >
      <h2 className="text-base font-semibold">Send a ticket</h2>
      <div className="space-y-1">
        <Label htmlFor="try-workspace">Workspace</Label>
        <select
          id="try-workspace"
          value={workspaceId}
          onChange={(event) => setWorkspaceId(event.target.value)}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
        >
          {workspaces.map((each) => (
            <option key={each.id} value={each.id}>
              {each.name} ({PLAN_LABELS[each.plan]}, {each.tracker})
            </option>
          ))}
        </select>
        {workspace && (
          <p className="text-xs text-muted-foreground">
            {PLAN_LABELS[workspace.plan]} plan, {formatUsd(workspace.arr)} ARR. Duplicates are
            looked up among the {workspace.tracker} issues. Jev never sees the plan or the ARR; the
            policy does.
          </p>
        )}
        <FieldError errors={errors.workspaceId} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="try-subject">Subject</Label>
        <Input
          id="try-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          aria-invalid={errors.subject ? true : undefined}
        />
        <FieldError errors={errors.subject} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="try-text">The customer's message</Label>
        <Textarea
          id="try-text"
          rows={8}
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-invalid={errors.text ? true : undefined}
          aria-describedby="try-count"
        />
        <p
          id="try-count"
          className={
            used > TRY_IT_MAX_CHARS ? "text-xs text-destructive" : "text-xs text-muted-foreground"
          }
        >
          {used.toLocaleString("en-US")} of {TRY_IT_MAX_CHARS.toLocaleString("en-US")} characters
        </p>
        <FieldError errors={errors.text} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Triage it"}
      </Button>
    </form>
  );
}

function Reply({ detail }: { detail: TicketDetail }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, startTransition] = useTransition();
  const used =
    detail.subject.length +
    detail.messages.reduce((sum, message) => sum + message.text.length, 0) +
    text.trim().length;

  return (
    <form
      className="space-y-2 rounded-md bg-muted/40 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await addTryItReplyAction({ ticketId: detail.id, text });
          if (result.ok) {
            setErrors({});
            setText("");
            await queryClient.invalidateQueries({ queryKey: ["ticket", detail.id] });
          } else {
            setErrors(result.errors);
          }
        });
      }}
    >
      <Label htmlFor="try-reply">Add a customer reply</Label>
      <Textarea
        id="try-reply"
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="e.g. Now nobody on the team can log in, and we lost yesterday's chats."
      />
      <div className="flex items-center justify-between gap-3">
        <span
          className={
            used > TRY_IT_MAX_CHARS ? "text-xs text-destructive" : "text-xs text-muted-foreground"
          }
        >
          {used.toLocaleString("en-US")} of {TRY_IT_MAX_CHARS.toLocaleString("en-US")} characters in
          the ticket
        </span>
        <Button type="submit" size="sm" disabled={pending || detail.triaging}>
          {pending ? "Sending…" : "Add reply"}
        </Button>
      </div>
      <FieldError errors={errors.text ?? errors.ticketId} />
    </form>
  );
}

function SimulateIncident() {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState<number | null>(null);
  return (
    <section aria-labelledby="simulate" className="space-y-2 rounded-lg border p-4">
      <h2 id="simulate" className="text-base font-semibold">
        Simulate an incident
      </h2>
      <p className="text-sm text-muted-foreground">
        Six customers report the same agent outage within a minute. Once five related tickets arrive
        within 30 minutes, the spike detector opens an incident and they all become Urgent. Counting
        is code; Jev only says what each ticket is about.
      </p>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await simulateIncidentAction();
            setSent(result.tickets);
          })
        }
      >
        <Siren /> {pending ? "Sending…" : "Simulate incident"}
      </Button>
      {sent !== null && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Sent {sent} tickets. Watch the banner on top, and the inbox.
        </p>
      )}
    </section>
  );
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors) return null;
  return <p className="text-xs text-destructive">{errors.join(" ")}</p>;
}
