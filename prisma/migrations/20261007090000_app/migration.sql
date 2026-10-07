-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "acceptedAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Triage" ADD COLUMN     "previousPriority" TEXT,
ADD COLUMN     "priorityChangedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "EvalReport" (
    "part" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "importedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvalReport_pkey" PRIMARY KEY ("part")
);

-- CreateTable
CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL,
    "part" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "questionSetVersion" TEXT NOT NULL,
    "questionSetHash" TEXT NOT NULL,
    "splitVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "itemCount" INTEGER NOT NULL,

    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvalItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "set" TEXT NOT NULL,
    "tracker" TEXT NOT NULL,
    "gold" JSONB NOT NULL,
    "state" JSONB NOT NULL,
    "candidateMap" JSONB NOT NULL,
    "answers" JSONB NOT NULL,
    "baselines" JSONB NOT NULL,
    "ms" INTEGER NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "typeCorrect" BOOLEAN NOT NULL,
    "areaCorrect" BOOLEAN NOT NULL,
    "duplicateCorrect" BOOLEAN NOT NULL,

    CONSTRAINT "EvalItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvalItem_itemId_idx" ON "EvalItem"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "EvalItem_runId_itemId_key" ON "EvalItem"("runId", "itemId");

-- AddForeignKey
ALTER TABLE "EvalItem" ADD CONSTRAINT "EvalItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EvalRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

