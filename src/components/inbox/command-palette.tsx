"use client";

import { useRouter } from "next/navigation";

import type { InboxView } from "@/components/inbox/inbox";
import type { InboxAction } from "@/components/inbox/keymap";
import type { InboxRow } from "@/lib/reads/inbox";

import { PriorityIcon } from "@/components/priority";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { PRIORITY_KEYS, PRIORITY_LABELS } from "@/lib/labels";
import { TRIAGE_PRIORITIES } from "@/lib/priorities";

// ⌘K (plan M5): the same actions as the keys, plus views and pages, for
// people who'd rather search than remember.

const PAGES = [
  ["/inbox", "Inbox"],
  ["/demand", "Feature demand"],
  ["/policy", "Policy"],
  ["/eval", "Evaluation"],
  ["/try", "Try it"],
] as const;

export function CommandPalette({
  open,
  onOpenChange,
  selected,
  panelOpen,
  onAction,
  onView,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: InboxRow | null;
  panelOpen: boolean;
  onAction: (action: InboxAction) => void;
  onView: (view: InboxView) => void;
}) {
  const router = useRouter();
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Commands">
      <Command>
        <CommandInput placeholder="Type a command…" />
        <CommandList>
          <CommandEmpty>No command matches.</CommandEmpty>
          {selected && (
            <CommandGroup heading={selected.subject}>
              {TRIAGE_PRIORITIES.map((priority) => (
                <CommandItem
                  key={priority}
                  onSelect={() => onAction({ type: "setPriority", id: selected.id, priority })}
                >
                  <PriorityIcon priority={priority} />
                  Set priority: {PRIORITY_LABELS[priority]}
                  <CommandShortcut>{PRIORITY_KEYS[priority]}</CommandShortcut>
                </CommandItem>
              ))}
              <CommandItem onSelect={() => onAction({ type: "accept", id: selected.id })}>
                Accept the suggested triage
                <CommandShortcut>a</CommandShortcut>
              </CommandItem>
              {panelOpen ? (
                <CommandItem onSelect={() => onAction({ type: "close" })}>
                  Close the ticket
                  <CommandShortcut>Esc</CommandShortcut>
                </CommandItem>
              ) : (
                <CommandItem onSelect={() => onAction({ type: "open", id: selected.id })}>
                  Open the ticket
                  <CommandShortcut>↵</CommandShortcut>
                </CommandItem>
              )}
            </CommandGroup>
          )}
          <CommandGroup heading="Views">
            <CommandItem onSelect={() => onView("all")}>All tickets</CommandItem>
            <CommandItem onSelect={() => onView("review")}>Needs review</CommandItem>
            <CommandItem onSelect={() => onView("moved")}>
              Moved by the last policy save
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Go to">
            {PAGES.map(([href, label]) => (
              <CommandItem
                key={href}
                onSelect={() => {
                  onOpenChange(false);
                  router.push(href);
                }}
              >
                {label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
