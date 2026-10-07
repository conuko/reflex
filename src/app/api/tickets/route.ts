import { db } from "@/lib/db";
import { listInbox } from "@/lib/reads/inbox";

// The inbox list as JSON; the inbox refetches it on every live hint.
export async function GET() {
  return Response.json(await listInbox(db()));
}
