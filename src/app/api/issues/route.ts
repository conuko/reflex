import { db } from "@/lib/db";
import { searchIssues } from "@/lib/reads/lookups";

// Issues to link a ticket to: `?tracker=librechat&q=okta`.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const tracker = params.get("tracker");
  if (!tracker) return Response.json({ error: "tracker is required" }, { status: 400 });
  return Response.json(await searchIssues(db(), { tracker, query: params.get("q") ?? "" }));
}
