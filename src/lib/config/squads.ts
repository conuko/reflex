import type { Area, TicketType } from "@/lib/triage/questions";

// Who a triaged ticket goes to. Questions and tickets without a request go to
// support and billing matters to billing; bugs and feature requests go to the
// squad that owns their product area.

export const SQUADS = [
  "support",
  "billing",
  "chat",
  "agents",
  "automation",
  "knowledge",
  "platform",
  "identity",
] as const;

export type Squad = (typeof SQUADS)[number];

export const AREA_SQUADS: Record<Area, Squad> = {
  chat: "chat",
  agents: "agents",
  workflows: "automation",
  integrations: "automation",
  knowledge_library: "knowledge",
  models: "platform",
  api: "platform",
  admin_sso: "identity",
  other: "support",
};

/** Whether the ticket's area decides its squad; when it doesn't, the area answer goes unused. */
export function routesByArea(type: TicketType): boolean {
  return type === "bug" || type === "feature_request";
}

export function squadFor(type: TicketType, area: Area): Squad {
  if (type === "account_billing") return "billing";
  return routesByArea(type) ? AREA_SQUADS[area] : "support";
}
