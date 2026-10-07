"use client";

import { useQueryClient } from "@tanstack/react-query";

import type { TriagePriority } from "@/lib/priorities";
import type { InboxData } from "@/lib/reads/inbox";
import type { TicketDetail } from "@/lib/reads/ticket";

import { acceptAction, setPriorityAction } from "@/app/actions/tickets";

// Set a priority or accept a triage from the keys, the palette or a button.
// The list and the panel show the change at once; the refetch afterwards
// brings what the server stored.

/** The fields both the list row and the detail have. */
type Change = { priority?: TriagePriority; humanSet?: boolean; accepted?: boolean };

export function useTicketActions() {
  const queryClient = useQueryClient();

  const patch = (id: string, change: Change) => {
    queryClient.setQueryData<InboxData>(
      ["tickets"],
      (data) =>
        data && {
          ...data,
          rows: data.rows.map((row) => (row.id === id ? { ...row, ...change } : row)),
        },
    );
    queryClient.setQueryData<TicketDetail>(
      ["ticket", id],
      (detail) => detail && { ...detail, ...change },
    );
  };
  const refetch = async (id: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tickets"] }),
      queryClient.invalidateQueries({ queryKey: ["ticket", id] }),
    ]);
  };

  return {
    async setPriority(id: string, priority: TriagePriority) {
      patch(id, { priority, humanSet: true, accepted: true });
      try {
        await setPriorityAction(id, priority);
      } finally {
        await refetch(id);
      }
    },
    async accept(id: string) {
      patch(id, { accepted: true });
      try {
        await acceptAction(id);
      } finally {
        await refetch(id);
      }
    },
  };
}
