"use client";

import type { ReactNode } from "react";

import { cn } from "cn";
import { BarChart3, FlaskConical, Inbox, Scale, Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useIncidents } from "@/components/queries";

// The frame around every page: navigation on the left, the incident banner
// on top. The banner follows open incidents live.

const NAV = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/demand", label: "Feature demand", icon: BarChart3 },
  { href: "/policy", label: "Policy", icon: Scale },
  { href: "/eval", label: "Evaluation", icon: FlaskConical },
  { href: "/try", label: "Try it", icon: Sparkles },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex h-dvh overflow-hidden">
      <nav className="flex w-52 shrink-0 flex-col gap-1 border-r bg-sidebar p-3 text-sm">
        <Link href="/inbox" className="mb-4 px-2 pt-1 text-base font-semibold tracking-tight">
          Reflex
        </Link>
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              pathname.startsWith(href) && "bg-sidebar-accent font-medium text-sidebar-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
        <p className="mt-auto px-2 text-xs text-muted-foreground">
          Jev answers questions; the policy decides.
        </p>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <IncidentBanner />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

function IncidentBanner() {
  const { data: incidents = [] } = useIncidents();
  if (incidents.length === 0) return null;
  return (
    <div
      aria-live="polite"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
    >
      <TriangleAlert className="size-4 shrink-0" />
      {incidents.map((incident) => (
        <span key={incident.id}>
          <strong className="font-semibold">Incident:</strong> {incident.label}.{" "}
          {incident.ticketCount} tickets in 30 minutes, all Urgent while it lasts.
        </span>
      ))}
    </div>
  );
}
