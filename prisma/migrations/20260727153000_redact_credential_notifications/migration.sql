UPDATE "Notification"
SET "body" = CASE
  WHEN "templateKey" = 'PASSWORD_RESET'
    THEN 'A password reset email was requested for this account.'
  ELSE 'A one-time password setup email was requested for this account.'
END
WHERE "templateKey" IN ('PASSWORD_RESET', 'STAFF_PASSWORD_SETUP');
