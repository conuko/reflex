-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'corpus';

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tracker" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "arr" INTEGER NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceIssueId" TEXT,
    "humanPriority" TEXT,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Judgment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "requestId" TEXT,
    "questionSetVersion" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "candidateMap" JSONB NOT NULL,
    "answers" JSONB NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "origin" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Judgment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Triage" (
    "ticketId" TEXT NOT NULL,
    "judgmentId" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "priority" TEXT NOT NULL,
    "ruleFired" TEXT NOT NULL,
    "needsReview" BOOLEAN NOT NULL,
    "reviewReasons" TEXT[],
    "squad" TEXT NOT NULL,
    "trace" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Triage_pkey" PRIMARY KEY ("ticketId")
);

-- CreateTable
CREATE TABLE "Policy" (
    "version" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "TicketIssueLink" (
    "ticketId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketIssueLink_pkey" PRIMARY KEY ("ticketId","issueId")
);

-- CreateTable
CREATE TABLE "Correction" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Correction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),
    "ticketCount" INTEGER NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_externalId_key" ON "Ticket"("externalId");

-- CreateIndex
CREATE INDEX "Ticket_workspaceId_idx" ON "Ticket"("workspaceId");

-- CreateIndex
CREATE INDEX "Ticket_createdAt_idx" ON "Ticket"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_ticketId_position_key" ON "Message"("ticketId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Message_ticketId_externalId_key" ON "Message"("ticketId", "externalId");

-- CreateIndex
CREATE INDEX "Judgment_ticketId_messageCount_idx" ON "Judgment"("ticketId", "messageCount");

-- CreateIndex
CREATE INDEX "Triage_priority_idx" ON "Triage"("priority");

-- CreateIndex
CREATE INDEX "TicketIssueLink_issueId_idx" ON "TicketIssueLink"("issueId");

-- CreateIndex
CREATE INDEX "Incident_closedAt_idx" ON "Incident"("closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_groupKey_windowStart_key" ON "Incident"("groupKey", "windowStart");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Judgment" ADD CONSTRAINT "Judgment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Triage" ADD CONSTRAINT "Triage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Triage" ADD CONSTRAINT "Triage_judgmentId_fkey" FOREIGN KEY ("judgmentId") REFERENCES "Judgment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketIssueLink" ADD CONSTRAINT "TicketIssueLink_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketIssueLink" ADD CONSTRAINT "TicketIssueLink_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: saved policy versions are immutable (ADR-0001). A change is a
-- new version; this trigger rejects any update of an existing one. Prisma
-- doesn't model triggers, so the schema can't express this.
CREATE FUNCTION "Policy_reject_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Policy version % is immutable; save a new version instead', OLD."version";
END
$$;

CREATE TRIGGER "Policy_immutable"
BEFORE UPDATE ON "Policy"
FOR EACH ROW EXECUTE FUNCTION "Policy_reject_update"();
