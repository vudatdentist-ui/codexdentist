import "server-only";

import { deletePatientFileStageObjects } from "@/infrastructure/patient-files/object-gc";
import {
  createPatientFilePurgeManifests,
  reconcilePatientFilePurgeManifests,
} from "@/infrastructure/patient-files/purge-manifest";
import { prisma } from "@/lib/prisma";

const purgeSql = String.raw`
DO $purge$
DECLARE
  target_org_id text;
  relation_record record;
  fk_record record;
  organization_guard text;
  deleted_count integer;
  pending_count integer;
  made_progress boolean;
  remaining_summary text;
BEGIN
  SELECT "organizationId" INTO target_org_id FROM "_organization_purge_target" LIMIT 1;

  LOOP
    FOR relation_record IN
      SELECT DISTINCT cls.oid AS table_oid, ns.nspname AS schema_name, cls.relname AS table_name
      FROM pg_class cls
      JOIN pg_namespace ns ON ns.oid = cls.relnamespace
      JOIN pg_attribute attr ON attr.attrelid = cls.oid
      WHERE ns.nspname = 'public'
        AND cls.relkind = 'r'
        AND cls.relname <> 'PatientFilePurgeManifest'
        AND attr.attname = 'organizationId'
        AND NOT attr.attisdropped
    LOOP
      EXECUTE format(
        'INSERT INTO "_organization_purge_rows" (table_oid, table_name, row_tid, depth)
         SELECT %s, %L, ctid, 1 FROM %I.%I WHERE "organizationId" = $1
         ON CONFLICT DO NOTHING',
        relation_record.table_oid,
        relation_record.table_name,
        relation_record.schema_name,
        relation_record.table_name
      ) USING target_org_id;
    END LOOP;

    LOOP
      deleted_count := 0;

      FOR fk_record IN
        SELECT
          constraint_row.conrelid AS child_oid,
          child_ns.nspname AS child_schema,
          child_cls.relname AS child_table,
          constraint_row.confrelid AS parent_oid,
          parent_ns.nspname AS parent_schema,
          parent_cls.relname AS parent_table,
          string_agg(
            format(
              'child.%I IS NOT DISTINCT FROM parent.%I',
              child_attr.attname,
              parent_attr.attname
            ),
            ' AND ' ORDER BY key_position.ordinality
          ) AS join_condition
        FROM pg_constraint constraint_row
        JOIN pg_class child_cls ON child_cls.oid = constraint_row.conrelid
        JOIN pg_namespace child_ns ON child_ns.oid = child_cls.relnamespace
        JOIN pg_class parent_cls ON parent_cls.oid = constraint_row.confrelid
        JOIN pg_namespace parent_ns ON parent_ns.oid = parent_cls.relnamespace
        JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY AS key_position(attnum, ordinality)
          ON true
        JOIN pg_attribute child_attr
          ON child_attr.attrelid = constraint_row.conrelid
         AND child_attr.attnum = key_position.attnum
        JOIN pg_attribute parent_attr
          ON parent_attr.attrelid = constraint_row.confrelid
         AND parent_attr.attnum = constraint_row.confkey[key_position.ordinality]
        WHERE constraint_row.contype = 'f'
          AND child_ns.nspname = 'public'
          AND parent_ns.nspname = 'public'
        GROUP BY
          constraint_row.conrelid,
          child_ns.nspname,
          child_cls.relname,
          constraint_row.confrelid,
          parent_ns.nspname,
          parent_cls.relname
      LOOP
        SELECT CASE
          WHEN EXISTS (
            SELECT 1 FROM pg_attribute
            WHERE attrelid = fk_record.child_oid
              AND attname = 'organizationId'
              AND NOT attisdropped
          ) THEN format(' AND child."organizationId" = %L', target_org_id)
          ELSE ''
        END INTO organization_guard;
        EXECUTE format(
          'INSERT INTO "_organization_purge_rows" (table_oid, table_name, row_tid, depth)
           SELECT %s, %L, child.ctid, parent_marker.depth + 1
           FROM %I.%I child
           JOIN %I.%I parent ON %s
           %s
           JOIN "_organization_purge_rows" parent_marker
             ON parent_marker.table_oid = %s
            AND parent_marker.row_tid = parent.ctid
           ON CONFLICT DO NOTHING',
          fk_record.child_oid,
          fk_record.child_table,
          fk_record.child_schema,
          fk_record.child_table,
          fk_record.parent_schema,
          fk_record.parent_table,
          fk_record.join_condition,
          organization_guard,
          fk_record.parent_oid
        );
        GET DIAGNOSTICS pending_count = ROW_COUNT;
        deleted_count := deleted_count + pending_count;
      END LOOP;

      EXIT WHEN deleted_count = 0;
    END LOOP;

    SELECT count(*) INTO pending_count FROM "_organization_purge_rows";
    EXIT WHEN pending_count = 0;
    made_progress := false;

    FOR relation_record IN
      SELECT table_oid, table_name, max(depth) AS max_depth
      FROM "_organization_purge_rows"
      GROUP BY table_oid, table_name
      ORDER BY max(depth) DESC, table_name
    LOOP
      BEGIN
        EXECUTE format(
          'WITH deleted AS (
             DELETE FROM %s target
             USING "_organization_purge_rows" marker
             WHERE marker.table_oid = %s
               AND target.ctid = marker.row_tid
             RETURNING 1
           )
           SELECT count(*) FROM deleted',
          relation_record.table_oid::regclass,
          relation_record.table_oid
        ) INTO deleted_count;

        DELETE FROM "_organization_purge_rows"
        WHERE table_oid = relation_record.table_oid;
        made_progress := true;
      EXCEPTION WHEN foreign_key_violation THEN
        NULL;
      END;
    END LOOP;

    IF NOT made_progress THEN
      SELECT string_agg(summary.table_name || ':' || summary.row_count, ', ' ORDER BY summary.table_name)
      INTO remaining_summary
      FROM (
        SELECT table_name, count(*)::text AS row_count
        FROM "_organization_purge_rows"
        GROUP BY table_name
      ) summary;

      RAISE EXCEPTION
        'Unable to purge organization % because dependent rows remain: %',
        target_org_id,
        remaining_summary;
    END IF;
  END LOOP;
END
$purge$;
`;

export async function purgeOrganization(organizationId: string) {
  let manifestIds: string[] = [];
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        "patient-file-retention-global",
      );
      await tx.$executeRawUnsafe(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        `patient-file-organization:${organizationId}`,
      );

      const patientFiles = await tx.patientFile.findMany({
        where: { organizationId },
        select: {
          id: true,
          storageProvider: true,
          storageKey: true,
          sourceType: true,
          sourceId: true,
          previewStorageKey: true,
          thumbnailStorageKey: true,
        },
      });
      const stagedFiles = await tx.$queryRawUnsafe<OrganizationPurgeStageRow[]>(
        `SELECT "id", "storageProvider", "storageKey", "previewStorageKey", "thumbnailStorageKey"
         FROM "PatientFileObjectStage"
         WHERE "organizationId" = $1
           AND "state" <> 'DELETED'`,
        organizationId,
      );
      const staffAvatars = await tx.staffProfile.findMany({
        where: { organizationId },
        select: {
          id: true,
          avatarStorageProvider: true,
          avatarStorageKey: true,
          avatarThumbnailStorageKey: true,
        },
      });
      const learningAssets = await tx.learningAsset.findMany({
        where: { organizationId },
        select: {
          id: true,
          storageProvider: true,
          storageKey: true,
          previewStorageKey: true,
          thumbnailStorageKey: true,
        },
      });
      const accountingAttachments = await tx.accountingEntry.findMany({
        where: { organizationId },
        select: {
          id: true,
          attachmentStorageProvider: true,
          attachmentStorageKey: true,
          attachmentThumbnailStorageKey: true,
        },
      });

      const purgeObjects = [];
      for (const file of patientFiles) {
        if (file.sourceType === "EXTERNAL_URL") continue;
        const object = ownedStorageObject({
          id: file.id,
          organizationId,
          storageProvider: file.storageProvider ??
            (file.sourceType === "R2_UPLOAD"
              ? "r2"
              : file.sourceType === "LOCAL_UPLOAD"
                ? "local"
                : null),
          storageKey: file.storageKey ?? file.sourceId,
          previewStorageKey: file.previewStorageKey,
          thumbnailStorageKey: file.thumbnailStorageKey,
        });
        if (object) purgeObjects.push(object);
      }
      for (const stage of stagedFiles) {
        const object = ownedStorageObject({
          id: stage.id,
          organizationId,
          storageProvider: stage.storageProvider,
          storageKey: stage.storageKey,
          previewStorageKey: stage.previewStorageKey,
          thumbnailStorageKey: stage.thumbnailStorageKey,
        });
        if (object) purgeObjects.push(object);
      }
      for (const avatar of staffAvatars) {
        const object = ownedStorageObject({
          id: `staff-profile:${avatar.id}`,
          organizationId,
          storageProvider: avatar.avatarStorageProvider,
          storageKey: avatar.avatarStorageKey,
          previewStorageKey: null,
          thumbnailStorageKey: avatar.avatarThumbnailStorageKey,
        });
        if (object) purgeObjects.push(object);
      }
      for (const asset of learningAssets) {
        const object = ownedStorageObject({
          id: `learning-asset:${asset.id}`,
          organizationId,
          storageProvider: asset.storageProvider,
          storageKey: asset.storageKey,
          previewStorageKey: asset.previewStorageKey,
          thumbnailStorageKey: asset.thumbnailStorageKey,
        });
        if (object) purgeObjects.push(object);
      }
      for (const entry of accountingAttachments) {
        const object = ownedStorageObject({
          id: `accounting-entry:${entry.id}`,
          organizationId,
          storageProvider: entry.attachmentStorageProvider,
          storageKey: entry.attachmentStorageKey,
          previewStorageKey: null,
          thumbnailStorageKey: entry.attachmentThumbnailStorageKey,
        });
        if (object) purgeObjects.push(object);
      }

      manifestIds = await createPatientFilePurgeManifests(tx, purgeObjects);

      await tx.$executeRawUnsafe(`
        CREATE TEMP TABLE "_organization_purge_target" (
          "organizationId" text NOT NULL
        ) ON COMMIT DROP;
        CREATE TEMP TABLE "_organization_purge_rows" (
          table_oid oid NOT NULL,
          table_name text NOT NULL,
          row_tid tid NOT NULL,
          depth integer NOT NULL,
          PRIMARY KEY (table_oid, row_tid)
        ) ON COMMIT DROP;
      `);
      await tx.$executeRaw`
        INSERT INTO "_organization_purge_target" ("organizationId")
        VALUES (${organizationId})
      `;
      await tx.$executeRaw`
        INSERT INTO "_organization_purge_rows" (table_oid, table_name, row_tid, depth)
        SELECT 'public."Organization"'::regclass::oid, 'Organization', ctid, 0
        FROM "Organization"
        WHERE id = ${organizationId}
      `;
      await tx.$executeRawUnsafe(purgeSql);
    },
    {
      timeout: 60_000,
    },
  );

  const manifestResult = await reconcilePatientFilePurgeManifests(
    prisma,
    deletePatientFileStageObjects,
    { ids: manifestIds },
  );
  if (manifestResult.failed > 0) {
    throw new Error(`organization-purge-object-cleanup-failed:${manifestResult.failed}`);
  }
  return { manifestIds, ...manifestResult };
}

type OrganizationPurgeStageRow = {
  id: string;
  storageProvider: string;
  storageKey: string;
  previewStorageKey: string | null;
  thumbnailStorageKey: string | null;
};

function ownedStorageObject(input: {
  id: string;
  organizationId: string;
  storageProvider: string | null;
  storageKey: string | null;
  previewStorageKey: string | null;
  thumbnailStorageKey: string | null;
}) {
  if (!input.storageProvider || input.storageProvider === "external") {
    if (input.storageKey) {
      throw new Error(`organization-purge-storage-provider-missing:${input.id}`);
    }
    return null;
  }
  if (input.storageProvider !== "local" && input.storageProvider !== "r2") {
    throw new Error(`organization-purge-file-storage-provider-invalid:${input.id}`);
  }
  if (!input.storageKey) {
    throw new Error(`organization-purge-file-storage-key-missing:${input.id}`);
  }

  return {
    id: input.id,
    organizationId: input.organizationId,
    storageProvider: input.storageProvider,
    storageKey: input.storageKey,
    previewStorageKey: input.previewStorageKey,
    thumbnailStorageKey: input.thumbnailStorageKey,
  };
}
