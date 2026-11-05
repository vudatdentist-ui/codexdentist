import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("deploy", Path(__file__).with_name("deploy-hostinger.py"))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
SHA = "a" * 40


class DeploymentGuards(unittest.TestCase):
    def successful_run(self):
        return dict(head_sha=SHA, head_branch="main", event="push", status="completed",
                    conclusion="success", path=".github/workflows/ci.yml")

    def test_only_exact_successful_push_main_is_eligible(self):
        self.assertTrue(deploy.eligible(SHA, SHA, [self.successful_run()]))
        for key, value in [("head_sha", "b" * 40), ("head_branch", "feature"),
                           ("event", "pull_request"), ("status", "in_progress"),
                           ("conclusion", "failure"), ("path", ".github/workflows/other.yml")]:
            with self.subTest(key=key):
                self.assertFalse(deploy.eligible(SHA, SHA, [dict(self.successful_run(), **{key: value})]))
        self.assertFalse(deploy.eligible(SHA, "b" * 40, [self.successful_run()]))
        self.assertFalse(deploy.eligible("main", "main", [self.successful_run()]))

    def test_compose_changes_only_target_image(self):
        text = ('services:\n  postgres:\n    image: postgres:17-alpine\n  codexdentist:\n'
                '    image: codexdentist:old\n    environment:\n      AUTH_SECRET: ${AUTH_SECRET}\n'
                '    networks:\n      - data\n\n  other:\n    image: unrelated:latest\n'
                'networks:\n  data:\n    external: true\n')
        updated = deploy.replace_image(text, "codexdentist:" + SHA)
        self.assertEqual(updated.replace("codexdentist:" + SHA, "codexdentist:old"), text)
        for invalid in ["", "services:\n  other:\n    image: x\n", text.replace("    image: codexdentist:old\n", "")]:
            with self.assertRaises(ValueError):
                deploy.replace_image(invalid, "codexdentist:" + SHA)
        with self.assertRaises(ValueError):
            deploy.replace_image(text, "untrusted:latest")

    def test_migration_guard_checks_full_deployed_range(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root)
            migration = source / "prisma/migrations/new/migration.sql"
            migration.parent.mkdir(parents=True)
            migration.write_text('CREATE TABLE "Counter" (id TEXT PRIMARY KEY);')
            with patch.object(deploy, "capture", return_value="A\tprisma/migrations/new/migration.sql") as git:
                deploy.check_migrations(source, "b" * 40)
                self.assertIn("b" * 40 + "..HEAD", git.call_args.args[0])
                for sql in ["DROP TABLE x;", "TRUNCATE x;", "DELETE FROM x;", "ALTER TABLE x DROP COLUMN y;",
                            "CREATE TABLE x(id int); UPDATE x SET id=1;"]:
                    migration.write_text(sql)
                    with self.assertRaises(RuntimeError):
                        deploy.check_migrations(source, "b" * 40)
            with patch.object(deploy, "capture", return_value="M\tprisma/migrations/new/migration.sql"):
                with self.assertRaises(RuntimeError):
                    deploy.check_migrations(source, "b" * 40)

    def test_unresolved_marker_blocks_before_touching_docker(self):
        with tempfile.TemporaryDirectory() as root, patch.object(deploy, "ROOT", Path(root)), patch.object(deploy, "capture") as docker:
            (Path(root) / "needs-attention.json").write_text("{}")
            with self.assertRaises(RuntimeError):
                deploy.deploy(SHA, SHA)
            docker.assert_not_called()

    def test_manual_migration_review_is_exact_and_does_not_change_unattended_policy(self):
        import hashlib
        import json
        with tempfile.TemporaryDirectory() as root:
            source = Path(root)
            relative = "prisma/migrations/reviewed/migration.sql"
            sql = source / relative
            sql.parent.mkdir(parents=True)
            sql.write_text('ALTER TABLE x ADD CONSTRAINT scope CHECK (id IS NOT NULL);')
            review = source / "review.json"
            previous = "b" * 40
            document = dict(sha=SHA, previous=previous, migrations={relative: hashlib.sha256(sql.read_bytes()).hexdigest()})
            review.write_text(json.dumps(document))
            review.chmod(0o600)
            def git(args):
                return SHA if "rev-parse" in args else "A\t" + relative
            # The deployer runs on Linux; model its reviewed-file mode on Windows.
            from types import SimpleNamespace
            original_stat = Path.stat
            def reviewed_stat(target, *args, **kwargs):
                return SimpleNamespace(st_uid=0, st_mode=0o100600) if target == review else original_stat(target, *args, **kwargs)
            with patch.object(deploy, "capture", side_effect=git), patch.object(Path, "stat", reviewed_stat):
                with self.assertRaises(RuntimeError):
                    deploy.check_migrations(source, previous)
                deploy.check_migrations(source, previous, review)
                for changed in [dict(document, sha="c" * 40), dict(document, previous="c" * 40),
                                dict(document, migrations={}), dict(document, migrations={relative: "0" * 64})]:
                    review.write_text(json.dumps(changed))
                    with self.assertRaises(RuntimeError):
                        deploy.check_migrations(source, previous, review)
                review.write_text(json.dumps(document))
                sql.write_text("ALTER TABLE different;")
                with self.assertRaises(RuntimeError):
                    deploy.check_migrations(source, previous, review)

    def test_already_deployed_checks_health_without_build_or_backup(self):
        import json
        current = [{"Config": {"Labels": {deploy.REVISION: SHA}}}]
        with tempfile.TemporaryDirectory() as root, patch.object(deploy, "ROOT", Path(root)), \
                patch.object(deploy, "capture", return_value=json.dumps(current)), \
                patch.object(deploy, "health") as health, patch.object(deploy, "run") as command:
            deploy.deploy(SHA, SHA)
            command.assert_not_called()
            health.assert_called_once_with("http://127.0.0.1:3100")

    def test_failed_command_does_not_expose_captured_secret(self):
        import subprocess
        result = subprocess.CompletedProcess(["docker"], 1, "secret", "password")
        with patch.object(deploy.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(RuntimeError, r"^docker failed \(exit 1\)$"):
                deploy.capture(["docker", "inspect"])

    def test_migration_credentials_are_separate_encoded_and_target_bound(self):
        from urllib.parse import urlparse, unquote
        runtime = {"DATABASE_URL": "postgresql://runtime:runtime-secret@nc-migration-postgres/thegnebd_codexdentist?schema=public"}
        owner = {"POSTGRES_USER": "owner@role", "POSTGRES_PASSWORD": "synthetic:p@ss/word?%"}
        result = urlparse(deploy.migration_connection(runtime, owner))
        self.assertEqual(unquote(result.username), owner["POSTGRES_USER"])
        self.assertEqual(unquote(result.password), owner["POSTGRES_PASSWORD"])
        self.assertEqual(result.hostname, "nc-migration-postgres")
        self.assertEqual(result.path, "/thegnebd_codexdentist")
        self.assertEqual(result.query, "schema=public")
        self.assertIn("runtime-secret", runtime["DATABASE_URL"])
        for value in [{}, {"POSTGRES_USER": "runtime", "POSTGRES_PASSWORD": "secret"}]:
            with self.assertRaises(RuntimeError):
                deploy.migration_connection(runtime, value)
        for suffix in ["?host=other", "?database=other", "?PORT=1", "?user=other", "?connectionString=other"]:
            with self.assertRaises(RuntimeError):
                deploy.migration_connection({"DATABASE_URL": runtime["DATABASE_URL"].split("?")[0] + suffix}, owner)

    def test_default_grants_allow_runtime_data_without_ddl_or_role_elevation(self):
        sql = deploy.runtime_default_privileges(
            {"DATABASE_URL": "postgresql://runtime%22role:secret@nc-migration-postgres/thegnebd_codexdentist"},
            {"POSTGRES_USER": 'migration"owner'},
        )
        self.assertIn('FOR ROLE "migration""owner"', sql)
        self.assertIn('TO "runtime""role"', sql)
        self.assertIn("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES", sql)
        self.assertIn("GRANT USAGE, SELECT ON SEQUENCES", sql)
        self.assertNotIn("REFERENCES", sql)
        self.assertNotIn("ALTER ROLE", sql)
        self.assertNotIn("secret", sql)

    def test_restore_privilege_class_must_match_production_migrator(self):
        with patch.object(deploy, "run", return_value=b"t\n"):
            deploy.check_migration_identity()
        with patch.object(deploy, "run", return_value=b"f\n"):
            with self.assertRaises(RuntimeError):
                deploy.check_migration_identity()

    def test_owner_tcp_probe_keeps_credentials_out_of_arguments(self):
        connection = "postgresql://owner:synthetic-secret@nc-migration-postgres/thegnebd_codexdentist"
        with patch.object(deploy, "run") as command:
            deploy.check_migration_credentials("codexdentist:" + SHA, connection)
        args = command.call_args.args[0]
        self.assertIn("container:" + deploy.CONTAINER, args)
        self.assertIn("--env", args)
        self.assertNotIn("synthetic-secret", " ".join(args))
        self.assertEqual(command.call_args.kwargs["env"]["DATABASE_URL"], connection)
        self.assertIn(b"rolsuper", command.call_args.kwargs["input"])

    def test_restore_checks_limited_runtime_access_after_candidate_migrations(self):
        import subprocess
        with tempfile.TemporaryDirectory() as root:
            backup = Path(root)
            (backup / "database.dump").write_bytes(b"synthetic")
            with patch.object(deploy, "run") as commands, patch.object(deploy.subprocess, "run",
                    return_value=subprocess.CompletedProcess([], 0)):
                deploy.restore_drill(backup, "codexdentist:" + SHA, "isolated-test")
            inputs = [call.kwargs.get("input", b"") for call in commands.call_args_list]
            self.assertTrue(any(b"CREATE ROLE codexdentist_restore_runtime NOLOGIN" in data for data in inputs))
            self.assertTrue(any(b"ALTER DEFAULT PRIVILEGES FOR ROLE postgres" in data for data in inputs))
            self.assertTrue(any(b"SET ROLE codexdentist_restore_runtime" in data and b"has_table_privilege" in data for data in inputs))
            self.assertIn("limited runtime CRUD", (backup / "restore-verified").read_text())

    def test_public_probes_have_identified_agent_and_verify_schema(self):
        import io
        import json

        def response(request, **kwargs):
            self.assertEqual(request.get_header("User-agent"), "codexdentist-production-health")
            self.assertEqual(request.get_header("Host"), "codexdentist.com")
            self.assertEqual(kwargs["timeout"], 20)
            body = json.dumps(dict(status="ok", database="ok", schema="ok")).encode()
            result = io.BytesIO(body)
            result.status = 200
            return result

        with patch.object(deploy.urllib.request, "urlopen", side_effect=response) as request:
            deploy.health("https://codexdentist.com")
            self.assertEqual(request.call_count, 7)

    def exercise_cutover(self, fail_public):
        import contextlib
        import json
        with tempfile.TemporaryDirectory() as temporary, contextlib.ExitStack() as stack:
            root = Path(temporary)
            compose = root / "compose.yml"
            original = 'services:\n  codexdentist:\n    image: codexdentist:old\n    restart: unless-stopped\n  other:\n    image: untouched:latest\n'
            compose.write_text(original)
            (root / "releases" / SHA).mkdir(parents=True)
            (root / "backups").mkdir()
            current = {"Image": "sha256:old", "Config": {"Labels": {deploy.REVISION: "b" * 40},
                       "Env": ["DATABASE_URL=postgresql://user:secret@nc-migration-postgres/thegnebd_codexdentist"]}}
            inspections = iter([current, {"Config": {"Labels": {deploy.REVISION: SHA}}}])

            def capture(command):
                if command[:2] == ["docker", "inspect"]:
                    if command[-1] == deploy.POSTGRES:
                        return json.dumps([{"Config": {"Env": ["POSTGRES_USER=migration_owner", "POSTGRES_PASSWORD=owner-secret"]}}])
                    return json.dumps([next(inspections)])
                if command[:2] == ["docker", "port"]:
                    return "127.0.0.1:49163"
                if "rev-parse" in command:
                    return SHA
                return ""

            for name, value in [("ROOT", root), ("COMPOSE", compose)]:
                stack.enter_context(patch.object(deploy, name, value))
            stack.enter_context(patch.object(deploy, "capture", side_effect=capture))
            commands = stack.enter_context(patch.object(deploy, "run"))
            stack.enter_context(patch.object(deploy.subprocess, "run"))
            stack.enter_context(patch.object(deploy, "restore_drill"))
            stack.enter_context(patch.object(deploy, "check_migration_identity"))
            stack.enter_context(patch.object(deploy, "api", return_value={"object": {"sha": SHA}}))
            wait = stack.enter_context(patch.object(deploy, "wait_health"))
            public = stack.enter_context(patch.object(deploy, "health"))
            stack.enter_context(patch.object(deploy.time, "sleep"))
            if fail_public:
                public.side_effect = RuntimeError("Public health failed")
                with self.assertRaisesRegex(RuntimeError, "Public health failed"):
                    deploy.deploy(SHA, SHA)
                self.assertTrue((root / "needs-attention.json").exists())
                self.assertFalse((root / "current.json").exists())
                self.assertIn("image: codexdentist:rollback-", compose.read_text())
                self.assertEqual(wait.call_args.args[0], "http://127.0.0.1:3100")
            else:
                deploy.deploy(SHA, SHA)
                self.assertFalse((root / "needs-attention.json").exists())
                self.assertEqual(json.loads((root / "current.json").read_text())["sha"], SHA)
                self.assertEqual(compose.read_text(), original.replace("codexdentist:old", "codexdentist:" + SHA))
            for call in commands.call_args_list:
                command = call.args[0]
                if "up" in command:
                    self.assertEqual(command[-4:], ["--no-deps", "--pull", "never", "codexdentist"])
                if "migrate" in command or ("--env" in command and "node" in command):
                    self.assertIn("--env", command)
                    self.assertNotIn("owner-secret", " ".join(command))
                    self.assertIn("migration_owner:owner-secret@", call.kwargs["env"]["DATABASE_URL"])
                else:
                    self.assertNotIn("env", call.kwargs)
            self.assertEqual(current["Config"]["Env"], ["DATABASE_URL=postgresql://user:secret@nc-migration-postgres/thegnebd_codexdentist"])
            self.assertIn("image: untouched:latest", compose.read_text())

    def test_success_records_exact_revision_and_clears_marker(self):
        self.exercise_cutover(False)

    def test_public_failure_restores_previous_image_and_retains_marker(self):
        self.exercise_cutover(True)


if __name__ == "__main__":
    unittest.main()
