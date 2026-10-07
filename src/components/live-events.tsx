"use client";

import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useEffectEvent, useRef } from "react";

import type { ReflexEvent } from "@/lib/events";

import { eventSchema } from "@/lib/events";

// One Server-Sent Events connection per tab (plan M5). Every hint refetches
// what it names: a ticket hint its ticket and the list, anything else every
// query. The stream sends "open" on every (re)connect, so hints missed while
// disconnected only cost a refetch. Server-rendered pages opt in with
// <LiveRefresh />.

export type Hint = ReflexEvent | { type: "open" };
type Listener = (hint: Hint) => void;

const Subscribe = createContext<(listener: Listener) => () => void>(() => () => undefined);

export function LiveEvents({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    const source = new EventSource("/api/events");
    const notify = (hint: Hint) => {
      invalidate(queryClient, hint);
      for (const listener of listeners.current) listener(hint);
    };
    source.addEventListener("open", () => notify({ type: "open" }));
    source.addEventListener("message", (message: MessageEvent<string>) => {
      const parsed = eventSchema.safeParse(safeJson(message.data));
      if (parsed.success) notify(parsed.data);
    });
    return () => source.close();
  }, [queryClient]);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  return <Subscribe value={subscribe}>{children}</Subscribe>;
}

/** Calls `listener` on every live hint while mounted. */
export function useLiveHints(listener: Listener) {
  const subscribe = use(Subscribe);
  const onHint = useEffectEvent(listener);
  useEffect(() => subscribe((hint) => onHint(hint)), [subscribe]);
}

/** Re-renders a server-rendered page on live hints, at most every half second. */
export function LiveRefresh() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLiveHints(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => router.refresh(), 500);
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  return null;
}

function invalidate(queryClient: QueryClient, hint: Hint) {
  if (hint.type === "ticket") {
    void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    void queryClient.invalidateQueries({ queryKey: ["ticket", hint.ticketId] });
    return;
  }
  void queryClient.invalidateQueries();
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
