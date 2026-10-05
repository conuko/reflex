-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "tracker" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "duplicateOf" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "closedAt" TIMESTAMPTZ(3),
    "searchVector" tsvector,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Issue_searchVector_idx" ON "Issue" USING GIN ("searchVector");

-- CreateIndex
CREATE UNIQUE INDEX "Issue_tracker_number_key" ON "Issue"("tracker", "number");

-- Hand-written: a trigger keeps "searchVector" in sync with the title (weight
-- A) and the body (weight B), so the duplicate candidate search in
-- src/lib/triage/candidates.ts never reads a stale vector. Prisma doesn't
-- model functions or triggers, so the schema can't express this.
CREATE FUNCTION "Issue_searchVector_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."body", '')), 'B');
  RETURN NEW;
END
$$;

CREATE TRIGGER "Issue_searchVector_trigger"
BEFORE INSERT OR UPDATE OF "title", "body" ON "Issue"
FOR EACH ROW EXECUTE FUNCTION "Issue_searchVector_update"();
