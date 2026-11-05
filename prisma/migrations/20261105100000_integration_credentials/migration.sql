CREATE UNIQUE INDEX "IntegrationConnection_id_organizationId_key"
    ON "IntegrationConnection" ("id", "organizationId");

CREATE TABLE "IntegrationCredential" (
    "connectionId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("connectionId"),
    CONSTRAINT "IntegrationCredential_connectionId_organizationId_key" UNIQUE ("connectionId", "organizationId"),
    CONSTRAINT "IntegrationCredential_ciphertext_size_check" CHECK (octet_length("ciphertext") BETWEEN 1 AND 45000),
    CONSTRAINT "IntegrationCredential_connection_scope_fkey"
        FOREIGN KEY ("connectionId", "organizationId") REFERENCES "IntegrationConnection" ("id", "organizationId")
        ON DELETE CASCADE ON UPDATE RESTRICT
);
