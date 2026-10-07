import type { Db } from "@/lib/db";
import type { SpikeRules } from "@/lib/spike";

import { detectSpikes, groupKey, SPIKE_RULES } from "@/lib/spike";
import { storedAnswers } from "@/lib/triage/context";

// Opens and closes incidents from the spike detector (plan M4). The worker
// runs this every 5 minutes and soon after each triage. A group gets at most
// one incident per window: the (group, window) pair is unique, and a group
// with an open incident only updates its count. Incidents close when their
// group no longer spikes. The caller recomputes the returned tickets, so they
// become Urgent while the incident is open and return afterwards.

export type SpikeCheck = {
  opened: { incidentId: string; groupKey: string; ticketIds: string[] }[];
  closed: { incidentId: string; groupKey: string; ticketIds: string[] }[];
};

export async function runSpikeCheck(
  database: Db,
  { now = new Date(), rules = SPIKE_RULES }: { now?: Date; rules?: SpikeRules } = {},
): Promise<SpikeCheck> {
  const windowMs = rules.windowMinutes * 60_000;
  const recent = await database.triage.findMany({
    where: { ticket: { createdAt: { gt: new Date(now.getTime() - windowMs), lte: now } } },
    select: {
      ticketId: true,
      judgment: { select: { answers: true } },
      ticket: { select: { createdAt: true, workspace: { select: { tracker: true } } } },
    },
  });
  const spikes = detectSpikes(
    recent.map(({ ticketId, judgment, ticket }) => ({
      ticketId,
      groupKey: groupKey(storedAnswers.parse(judgment.answers), ticket.workspace.tracker),
      createdAt: ticket.createdAt,
    })),
    now,
    rules,
  );

  const open = await database.incident.findMany({ where: { closedAt: null } });
  const openByGroup = new Map(open.map((incident) => [incident.groupKey, incident]));
  const check: SpikeCheck = { opened: [], closed: [] };

  for (const spike of spikes) {
    const existing = openByGroup.get(spike.groupKey);
    if (existing) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await database.incident.update({
        where: { id: existing.id },
        data: { ticketCount: Math.max(existing.ticketCount, spike.ticketIds.length) },
      });
      continue;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop
    const incident = await database.incident.upsert({
      where: { groupKey_windowStart: { groupKey: spike.groupKey, windowStart: spike.windowStart } },
      create: {
        groupKey: spike.groupKey,
        windowStart: spike.windowStart,
        openedAt: now,
        ticketCount: spike.ticketIds.length,
      },
      update: { closedAt: null, ticketCount: spike.ticketIds.length },
    });
    check.opened.push({
      incidentId: incident.id,
      groupKey: spike.groupKey,
      ticketIds: spike.ticketIds,
    });
  }

  const spiking = new Set(spikes.map((spike) => spike.groupKey));
  for (const incident of open.filter(({ groupKey: key }) => !spiking.has(key))) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    await database.incident.update({ where: { id: incident.id }, data: { closedAt: now } });
    // oxlint-disable-next-line eslint/no-await-in-loop
    const urgent = await database.triage.findMany({
      where: { ruleFired: "spike" },
      select: {
        ticketId: true,
        judgment: { select: { answers: true } },
        ticket: { select: { workspace: { select: { tracker: true } } } },
      },
    });
    check.closed.push({
      incidentId: incident.id,
      groupKey: incident.groupKey,
      ticketIds: urgent
        .filter(
          ({ judgment, ticket }) =>
            groupKey(storedAnswers.parse(judgment.answers), ticket.workspace.tracker) ===
            incident.groupKey,
        )
        .map(({ ticketId }) => ticketId),
    });
  }
  return check;
}
