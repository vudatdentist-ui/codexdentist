ALTER TABLE "Chain" ADD COLUMN "ownerId" TEXT;

CREATE INDEX "Chain_ownerId_idx" ON "Chain"("ownerId");

ALTER TABLE "Chain"
ADD CONSTRAINT "Chain_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
