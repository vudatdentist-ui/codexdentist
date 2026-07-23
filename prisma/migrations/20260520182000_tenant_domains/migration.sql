ALTER TABLE "Organization"
ADD COLUMN "slug" TEXT,
ADD COLUMN "primaryDomain" TEXT;

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX "Organization_primaryDomain_key" ON "Organization"("primaryDomain");
