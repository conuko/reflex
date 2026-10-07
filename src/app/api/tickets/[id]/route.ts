import { db } from "@/lib/db";
import { ticketDetail } from "@/lib/reads/ticket";

// One ticket for the detail panel and Try it.
export async function GET(_request: Request, context: RouteContext<"/api/tickets/[id]">) {
  const { id } = await context.params;
  const detail = await ticketDetail(db(), id);
  if (!detail) return Response.json({ error: `No ticket ${id}` }, { status: 404 });
  return Response.json(detail);
}
