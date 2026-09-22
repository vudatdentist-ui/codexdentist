-- Hosted workspaces may begin with a time-limited trial. Paid or perpetual
-- workspaces keep this nullable so conversion does not require copying data.
ALTER TABLE "Organization"
ADD COLUMN "trialEndsAt" TIMESTAMP(3);

CREATE INDEX "Organization_trialEndsAt_idx"
ON "Organization"("trialEndsAt");
