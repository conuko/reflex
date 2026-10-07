import type { Db } from "@/lib/db";

import { AREA_LABELS, labelOf } from "@/lib/labels";

// Open incidents for the banner (plan M5), labeled from their group key:
// `issue:<id>` names the issue, `area:<tracker>:<area>` the area.

export type OpenIncident = {
  id: string;
  groupKey: string;
  label: string;
  ticketCount: number;
  openedAt: string;
  windowStart: string;
};

export async function openIncidents(database: Db): Promise<OpenIncident[]> {
  const incidents = await database.incident.findMany({
    where: { closedAt: null },
    orderBy: { openedAt: "desc" },
  });
  const issueIds = incidents.flatMap(({ groupKey }) =>
    groupKey.startsWith("issue:") ? [groupKey.slice("issue:".length)] : [],
  );
  const titles = new Map(
    (
      await database.issue.findMany({
        where: { id: { in: issueIds } },
        select: { id: true, title: true },
      })
    ).map(({ id, title }) => [id, title]),
  );

  return incidents.map((incident) => ({
    id: incident.id,
    groupKey: incident.groupKey,
    label: incidentLabel(incident.groupKey, titles),
    ticketCount: incident.ticketCount,
    openedAt: incident.openedAt.toISOString(),
    windowStart: incident.windowStart.toISOString(),
  }));
}

export function incidentLabel(groupKey: string, titles: ReadonlyMap<string, string>): string {
  if (groupKey.startsWith("issue:")) {
    const id = groupKey.slice("issue:".length);
    const title = titles.get(id);
    return title ? `${id}: ${title}` : id;
  }
  const [, tracker, area] = groupKey.split(":");
  if (tracker && area) return `${labelOf(AREA_LABELS, area)} in ${tracker}`;
  return groupKey;
}
