# Security Policy

## Reporting A Vulnerability

Do not open a public issue for security vulnerabilities, exposed credentials, tenant-isolation failures, or suspected patient-data exposure.

Use the repository's **Security** tab and select **Report a vulnerability** to open a private GitHub Security Advisory. Include:

- the affected version or commit;
- reproduction steps;
- the expected and actual behavior;
- the likely impact;
- a proposed mitigation, when available.

Do not include real patient data, production credentials, database dumps, session cookies, or private file-storage objects in a report. Use synthetic data and redact secrets.

## Supported Versions

Codexdentist is currently in beta. Security fixes are applied to the latest release line only.

Self-hosters are responsible for applying updates, using strong unique secrets, restricting database access, maintaining encrypted off-device backups, and serving production deployments over HTTPS.
