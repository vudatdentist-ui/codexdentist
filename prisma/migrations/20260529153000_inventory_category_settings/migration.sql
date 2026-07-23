-- AlterTable
ALTER TABLE "InventoryItem" ADD COLUMN "groupId" TEXT;

-- CreateTable
CREATE TABLE "InventoryItemGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItemGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryTag" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItemTag" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryItemTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryItem_groupId_idx" ON "InventoryItem"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItemGroup_organizationId_code_key" ON "InventoryItemGroup"("organizationId", "code");

-- CreateIndex
CREATE INDEX "InventoryItemGroup_organizationId_active_sortOrder_idx" ON "InventoryItemGroup"("organizationId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTag_organizationId_code_key" ON "InventoryTag"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryTag_organizationId_name_key" ON "InventoryTag"("organizationId", "name");

-- CreateIndex
CREATE INDEX "InventoryTag_organizationId_active_sortOrder_idx" ON "InventoryTag"("organizationId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItemTag_itemId_tagId_key" ON "InventoryItemTag"("itemId", "tagId");

-- CreateIndex
CREATE INDEX "InventoryItemTag_organizationId_tagId_idx" ON "InventoryItemTag"("organizationId", "tagId");

-- CreateIndex
CREATE INDEX "InventoryItemTag_organizationId_itemId_idx" ON "InventoryItemTag"("organizationId", "itemId");

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "InventoryItemGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItemGroup" ADD CONSTRAINT "InventoryItemGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTag" ADD CONSTRAINT "InventoryTag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItemTag" ADD CONSTRAINT "InventoryItemTag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItemTag" ADD CONSTRAINT "InventoryItemTag_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItemTag" ADD CONSTRAINT "InventoryItemTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "InventoryTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
