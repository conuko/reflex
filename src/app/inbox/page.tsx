import type { Metadata } from "next";

import { Inbox } from "@/components/inbox/inbox";
import { db } from "@/lib/db";
import { listInbox } from "@/lib/reads/inbox";
import { ticketDetail } from "@/lib/reads/ticket";

export const metadata: Metadata = { title: "Inbox" };

// Rendered with the list and the open ticket (`?t=`), so a reload or a shared
// link shows them at once; the client takes over from there.
export default async function InboxPage({ searchParams }: PageProps<"/inbox">) {
  const { t } = await searchParams;
  const openId = typeof t === "string" && t !== "" ? t : null;
  const database = db();
  const [initialData, initialTicket] = await Promise.all([
    listInbox(database),
    openId ? ticketDetail(database, openId) : null,
  ]);
  return (
    <Inbox
      initialData={initialData}
      initialTicket={initialTicket ?? undefined}
      initialOpenId={openId}
    />
  );
}
