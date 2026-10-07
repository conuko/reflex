import { db } from "@/lib/db";
import { openIncidents } from "@/lib/reads/incidents";

// Open incidents for the banner.
export async function GET() {
  return Response.json(await openIncidents(db()));
}
