"use client";

import type { ReactNode } from "react";

import { cn } from "cn";
import { ArrowRight, Link2, TriangleAlert } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import type { InboxAction } from "@/components/inbox/keymap";
import type { InboxData, InboxRow } from "@/lib/reads/inbox";
import type { TicketDetail } from "@/lib/reads/ticket";

import { timeAgo } from "@/components/format";
import { CommandPalette } from "@/components/inbox/command-palette";
import { isTypingTarget, keymap } from "@/components/inbox/keymap";
import { PriorityIcon } from "@/components/priority";
import { useInbox, useTicket } from "@/components/queries";
import { TicketPanel, TicketPanelSkeleton } from "@/components/ticket/ticket-panel";
import { useTicketActions } from "@/components/ticket/use-ticket-actions";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { AREA_LABELS, labelOf, PRIORITY_LABELS, TYPE_LABELS } from "@/lib/labels";

// The inbox (plan M5): a Linear-style list driven by the keys in keymap.ts.
// The open ticket is in the URL (`?t=`), so a link or a reload opens it again.

export type InboxView = "all" | "review" | "moved";

export function viewRows(data: InboxData, view: InboxView): InboxRow[] {
  if (view === "review") {
    return data.rows.filter((row) => row.needsReview && !row.accepted && !row.humanSet);
  }
  if (view === "moved") return data.rows.filter((row) => movedByPolicy(row, data.policy));
  return data.rows;
}

/** The policy in force moved this row: its priority changed after the policy was saved. */
function movedByPolicy(row: InboxRow, policy: InboxData["policy"]): boolean {
  return (
    policy.version > 1 &&
    row.previousPriority !== null &&
    row.priorityChangedAt !== null &&
    row.priorityChangedAt >= policy.savedAt
  );
}

export function Inbox({
  initialData,
  initialTicket,
  initialOpenId,
}: {
  initialData: InboxData;
  initialTicket?: TicketDetail;
  initialOpenId: string | null;
}) {
  const { data = initialData } = useInbox(initialData);
  const [view, setView] = useState<InboxView>("all");
  const [selectedId, setSelectedId] = useState<string | null>(initialOpenId);
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const detail = useTicket(openId, initialTicket);
  const ticket = detail.data;
  const actions = useTicketActions();
  const rows = viewRows(data, view);
  const rowIds = rows.map(({ id }) => id);

  const open = (id: string | null) => {
    setOpenId(id);
    const params = new URLSearchParams(window.location.search);
    if (id) params.set("t", id);
    else params.delete("t");
    const query = params.toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  };

  const dispatch = (action: InboxAction) => {
    switch (action.type) {
      case "select":
        setSelectedId(action.id);
        if (openId !== null) open(action.id);
        document.getElementById(`row-${action.id}`)?.scrollIntoView({ block: "nearest" });
        return;
      case "open":
        setSelectedId(action.id);
        open(action.id);
        return;
      case "close":
        open(null);
        return;
      case "setPriority":
        void actions.setPriority(action.id, action.priority);
        return;
      case "accept":
        void actions.accept(action.id);
        return;
      case "togglePalette":
        setPaletteOpen((isOpen) => !isOpen);
        return;
      case "none":
        return;
    }
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const action = keymap(
      { rowIds, selectedId, panelOpen: openId !== null, paletteOpen },
      event,
      isTypingTarget(event.target),
    );
    if (action.type === "none") return;
    event.preventDefault();
    dispatch(action);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const counts = {
    all: data.rows.length,
    review: viewRows(data, "review").length,
    moved: viewRows(data, "moved").length,
  };

  return (
    <div className="flex h-full">
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Tickets">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
          <h1 className="text-base font-semibold">Inbox</h1>
          <div className="flex gap-1" role="tablist" aria-label="Views">
            <ViewTab view="all" current={view} count={counts.all} onSelect={setView}>
              All
            </ViewTab>
            <ViewTab view="review" current={view} count={counts.review} onSelect={setView}>
              Needs review
            </ViewTab>
            {counts.moved > 0 && (
              <ViewTab view="moved" current={view} count={counts.moved} onSelect={setView}>
                Moved by policy v{data.policy.version}
              </ViewTab>
            )}
          </div>
          <p
            className={cn(
              "ml-auto hidden items-center gap-1 text-xs text-muted-foreground lg:flex",
              openId !== null && "lg:hidden 2xl:flex",
            )}
          >
            <Kbd>j</Kbd>
            <Kbd>k</Kbd> move <Kbd>↵</Kbd> open <Kbd>1</Kbd>–<Kbd>5</Kbd> priority <Kbd>a</Kbd>{" "}
            accept <Kbd>⌘K</Kbd> commands
          </p>
        </header>
        <ul aria-label="Tickets" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          {rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              open={row.id === openId}
              moved={movedByPolicy(row, data.policy)}
              compact={openId !== null}
              onClick={() => dispatch({ type: "open", id: row.id })}
            />
          ))}
          {rows.length === 0 && (
            <li className="p-8 text-center text-sm text-muted-foreground">
              No tickets here. Run <code>pnpm seed:demo</code> for the demo data.
            </li>
          )}
        </ul>
      </section>
      {openId !== null && (
        <aside
          className="w-[min(36rem,60%)] shrink-0 overflow-auto border-l bg-background"
          aria-label="Ticket"
        >
          {ticket ? (
            <TicketPanel
              detail={ticket}
              onClose={() => open(null)}
              onSetPriority={(priority) => void actions.setPriority(ticket.id, priority)}
              onAccept={() => void actions.accept(ticket.id)}
            />
          ) : detail.isError ? (
            <p className="p-5 text-sm text-muted-foreground">This ticket no longer exists.</p>
          ) : (
            <TicketPanelSkeleton />
          )}
        </aside>
      )}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        selected={rows.find(({ id }) => id === selectedId) ?? null}
        panelOpen={openId !== null}
        onAction={(action) => {
          setPaletteOpen(false);
          dispatch(action);
        }}
        onView={(next) => {
          setPaletteOpen(false);
          setView(next);
        }}
      />
    </div>
  );
}

function ViewTab({
  view,
  current,
  count,
  onSelect,
  children,
}: {
  view: InboxView;
  current: InboxView;
  count: number;
  onSelect: (view: InboxView) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={view === current}
      onClick={() => onSelect(view)}
      className={cn(
        "rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted",
        view === current && "bg-muted font-medium text-foreground",
      )}
    >
      {children} <span className="tabular-nums">{count}</span>
    </button>
  );
}

function Row({
  row,
  selected,
  open,
  moved,
  compact,
  onClick,
}: {
  row: InboxRow;
  selected: boolean;
  open: boolean;
  moved: boolean;
  /** Next to an open ticket: only the priority, the subject and the age. */
  compact: boolean;
  onClick: () => void;
}) {
  const review = row.needsReview && !row.accepted && !row.humanSet;
  return (
    <li
      id={`row-${row.id}`}
      className={cn(
        "border-b border-border/60",
        selected && "bg-muted",
        open && "shadow-[inset_2px_0_0_var(--color-primary)]",
      )}
    >
      <button
        type="button"
        tabIndex={selected ? 0 : -1}
        aria-current={selected ? "true" : undefined}
        onClick={onClick}
        className="grid w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left text-sm hover:bg-muted/60"
      >
        <PriorityIcon priority={row.triaging && row.priority === null ? null : row.priority} />
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate", !row.accepted && "font-medium")}>{row.subject}</span>
          {review && (
            <TriangleAlert className="size-3.5 shrink-0 text-amber-600" aria-label="Needs review" />
          )}
          {!compact && row.linkedIssueIds[0] && (
            <Badge variant="outline" className="shrink-0 font-mono">
              <Link2 /> {row.linkedIssueIds[0]}
            </Badge>
          )}
          {moved && !compact && row.previousPriority && row.priority && (
            <Badge variant="secondary" className="shrink-0">
              {PRIORITY_LABELS[row.previousPriority]} <ArrowRight /> {PRIORITY_LABELS[row.priority]}
            </Badge>
          )}
          {row.triaging && row.priority !== null && (
            <span className="shrink-0 text-xs text-muted-foreground">re-triaging</span>
          )}
        </span>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          {!compact && (
            <>
              <span className="hidden xl:inline">
                {labelOf(TYPE_LABELS, row.type)} · {labelOf(AREA_LABELS, row.area)}
              </span>
              <span className="hidden w-36 truncate md:inline">{row.workspace.name}</span>
              {row.workspace.plan === "enterprise" && <Badge variant="secondary">Enterprise</Badge>}
            </>
          )}
          <span className="w-8 text-right whitespace-nowrap tabular-nums" suppressHydrationWarning>
            {timeAgo(row.createdAt)}
          </span>
        </span>
      </button>
    </li>
  );
}
