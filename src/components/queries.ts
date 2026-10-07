"use client";

import { useQuery } from "@tanstack/react-query";

import type { InboxData } from "@/lib/reads/inbox";
import type { OpenIncident } from "@/lib/reads/incidents";
import type { IssueOption } from "@/lib/reads/lookups";
import type { TicketDetail } from "@/lib/reads/ticket";

// The app's client-side reads, all from the JSON routes in src/app/api/.
// Query keys: ["tickets"], ["ticket", id], ["incidents"], ["issues", …].

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const body: T = await response.json();
  return body;
}

export function useInbox(initialData?: InboxData) {
  return useQuery({
    queryKey: ["tickets"],
    queryFn: () => fetchJson<InboxData>("/api/tickets"),
    initialData,
  });
}

export function useTicket(id: string | null, initialData?: TicketDetail) {
  return useQuery({
    queryKey: ["ticket", id],
    queryFn: () => fetchJson<TicketDetail>(`/api/tickets/${encodeURIComponent(id ?? "")}`),
    enabled: id !== null,
    initialData: initialData?.id === id ? initialData : undefined,
  });
}

export function useIncidents() {
  return useQuery({
    queryKey: ["incidents"],
    queryFn: () => fetchJson<OpenIncident[]>("/api/incidents"),
  });
}

export function useIssueSearch(tracker: string, query: string) {
  return useQuery({
    queryKey: ["issues", tracker, query],
    queryFn: () =>
      fetchJson<IssueOption[]>(
        `/api/issues?tracker=${encodeURIComponent(tracker)}&q=${encodeURIComponent(query)}`,
      ),
  });
}
