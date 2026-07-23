# Codexdentist

Codexdentist is an open-source dental clinic operating system for Viet Nam. It combines scheduling, patient records, clinical journeys, billing, inventory, pharmacy, staff operations, CRM, forms, and reporting in one multi-tenant application.

## Try It

- Product website: `https://codexdentist.com`
- 24-hour isolated demo: `https://demo.codexdentist.com`
- Installation guide: `https://codexdentist.com/docs`

The public demo stores changes temporarily inside a separate organization and automatically expires it. Do not enter real patient information into the demo.

## Self-Host

Requirements:

- Node.js 22 LTS
- Docker Desktop or Docker Engine with Compose
- At least 4 GB RAM and 10 GB free disk space for a small clinic

Windows:

```powershell
git clone https://github.com/vudatdentist-ui/codexdentist.git
cd codexdentist
.\install.ps1
```

Linux or macOS:

```bash
git clone https://github.com/vudatdentist-ui/codexdentist.git
cd codexdentist
chmod +x install.sh
./install.sh
```

The installer creates `.env.selfhost` with random secrets, builds the application, starts PostgreSQL, applies migrations, and prints LAN addresses. Open `http://127.0.0.1:3000/setup` to create the first clinic and owner account.

## Operations

```bash
npm run codexdentist -- start
npm run codexdentist -- stop
npm run codexdentist -- status
npm run codexdentist -- doctor
npm run codexdentist -- backup
npm run codexdentist -- restore backups/<folder> --confirm
npm run codexdentist -- update
```

Backups contain a PostgreSQL custom dump and a patient-file archive. Keep a copy outside the clinic server and test a restore before using the system with real patients.

## Development

```bash
docker compose up -d
npm install
npm run prisma:generate
npm run prisma:migrate
npm run test:seed-users
npm run dev
```

Open `http://127.0.0.1:3000`.

Verification:

```bash
npm run encoding:check
npm run typecheck
npm run build
npm run test:smoke
npm run test:tenant
npm run test:hardening
npm run browser:qa
```

## Deployment Modes

- `self-hosted`: local patient-file volume is allowed and `/setup` is available only while the database has no organization.
- `hosted`: HTTPS, private R2 storage, tenant subdomains, strong secrets, and external backup are required.
- `demo`: enabled only with `DEMO_WORKSPACE_ENABLED=true`; each workspace is an expiring tenant and outbound delivery/file upload are disabled.

Optional providers for AI, email, SMS, Zalo, and R2 are configured through environment variables. They are disabled by default in self-host installations.

## Project Rules

- PostgreSQL is canonical.
- Operational records are scoped by `organizationId`.
- Clinic records also respect accessible clinic ids.
- Permissions are enforced in loaders and actions.
- Vietnamese UI text is UTF-8.
- Patient files are protected records and never public assets.
- Migrations and backups must preserve existing data.

See `AGENTS.md`, `docs/PROJECT_CONTEXT.md`, `docs/QA_PLAYBOOK.md`, and `docs/OPERATIONS.md` for the active engineering and operations context.

## Contributing

Read `CONTRIBUTING.md` before submitting a change. Never place credentials, database dumps, real patient data, or real clinic screenshots in an issue or pull request.

## License

Codexdentist is licensed under the GNU Affero General Public License v3.0 or later (`AGPL-3.0-or-later`). See `LICENSE`.
