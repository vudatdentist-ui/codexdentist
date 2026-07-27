CREATE FUNCTION "assert_patient_portal_user_scope"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  portal_organization_id TEXT;
  portal_role "UserRole";
  has_patient_assignment BOOLEAN;
BEGIN
  IF NEW."portalUserId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "organizationId", role
  INTO portal_organization_id, portal_role
  FROM "User"
  WHERE id = NEW."portalUserId";

  SELECT EXISTS (
    SELECT 1
    FROM "UserRoleAssignment"
    WHERE "userId" = NEW."portalUserId"
      AND role = 'PATIENT'
      AND active = TRUE
  )
  INTO has_patient_assignment;

  IF portal_organization_id IS DISTINCT FROM NEW."organizationId"
    OR (portal_role IS DISTINCT FROM 'PATIENT' AND NOT has_patient_assignment)
  THEN
    RAISE EXCEPTION 'patient portal user must be an active patient identity in the same organization'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "Patient_portal_user_scope_check"
BEFORE INSERT OR UPDATE OF "organizationId", "portalUserId"
ON "Patient"
FOR EACH ROW EXECUTE PROCEDURE "assert_patient_portal_user_scope"();
