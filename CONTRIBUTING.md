# Contributing to Codexdentist

Codexdentist accepts focused fixes and improvements that preserve tenant isolation, clinical record integrity, and Vietnamese UTF-8 text.

## Before Opening A Pull Request

1. Create an issue for large product or schema changes.
2. Keep clinic data scoped by `organizationId` and accessible clinic ids.
3. Enforce permissions in server loaders and actions, not only in UI.
4. Never commit patient data, credentials, `.env` files, database dumps, or private storage objects.
5. Add a migration for every schema change. Never rewrite an already released migration.

Run:

```bash
npm ci
npm run encoding:check
npm run typecheck
npm run build
npm run test:tenant
npm run test:hardening
```

High-risk billing, patient-file, auth, payroll, and tenant changes also require their targeted smoke suites from `docs/QA_PLAYBOOK.md`.

## Security Reports

Do not open a public issue for a vulnerability or suspected exposure of patient data. Use the repository's private GitHub Security Advisory flow. Include the affected version, reproduction steps, impact, and a proposed mitigation when available.

## Data And Screenshots

Use synthetic Vietnamese names, addresses, phone numbers, clinical notes, and images. Screenshots in documentation must come from a seeded demo organization and must not contain real patient or staff data.

## License And Brand

Contributions are licensed under `AGPL-3.0-or-later`. The source license does not grant rights to present a modified distribution as the official Codexdentist service or to imply endorsement by the project maintainers.
