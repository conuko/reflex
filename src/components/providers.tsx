"use client";

import type { ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { LiveEvents } from "@/components/live-events";
import { TooltipProvider } from "@/components/ui/tooltip";

// Client-side state for the whole app: TanStack Query, refetched by live
// hints rather than by timers or window focus.

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LiveEvents>{children}</LiveEvents>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
