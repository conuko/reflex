import type { LucideIcon } from "lucide-react";

import { cn } from "cn";
import { Ban, LoaderCircle, OctagonAlert, SignalHigh, SignalLow, SignalMedium } from "lucide-react";

import type { TriagePriority } from "@/lib/priorities";

import { PRIORITY_LABELS } from "@/lib/labels";

// How a priority looks everywhere: an icon and a color per level.

const LOOK: Record<TriagePriority, { icon: LucideIcon; className: string }> = {
  urgent: { icon: OctagonAlert, className: "text-red-600 dark:text-red-400" },
  high: { icon: SignalHigh, className: "text-orange-600 dark:text-orange-400" },
  medium: { icon: SignalMedium, className: "text-amber-600 dark:text-amber-400" },
  low: { icon: SignalLow, className: "text-muted-foreground" },
  wont_do: { icon: Ban, className: "text-muted-foreground/70" },
};

export function PriorityIcon({
  priority,
  className,
}: {
  priority: TriagePriority | null;
  className?: string;
}) {
  if (priority === null) {
    return (
      <LoaderCircle
        aria-label="Triaging"
        className={cn("size-4 animate-spin text-muted-foreground", className)}
      />
    );
  }
  const { icon: Icon, className: color } = LOOK[priority];
  return <Icon aria-label={PRIORITY_LABELS[priority]} className={cn("size-4", color, className)} />;
}

export function PriorityLabel({
  priority,
  className,
}: {
  priority: TriagePriority | null;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <PriorityIcon priority={priority} />
      <span>{priority === null ? "Triaging" : PRIORITY_LABELS[priority]}</span>
    </span>
  );
}
