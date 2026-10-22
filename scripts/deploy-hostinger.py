#!/usr/bin/env python3
"""Root-owned pull deployment for the existing Hostinger Compose service.

No inbound webhook, GitHub credential, production reset, or other service update.
Install a reviewed copy outside the checkout; this program never updates itself.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.request

REPOSITORY = "vudatdentist-ui/codexdentist"
ROOT = Path("/opt/codexdentist-deploy")
COMPOSE = Path("/opt/namecheap-migration/compose.yml")
CONTAINER = "namecheap-migration-codexdentist-1"
POSTGRES = "namecheap-migration-postgres-1"
DATABASE = "thegnebd_codexdentist"
REVISION = "org.opencontainers.image.revision"


def run(args, **kwargs):
    # Do not include captured stderr/production configuration in exceptions.
    result = subprocess.run(args, check=False, **kwargs)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed (exit {result.returncode})")
    return result.stdout


def capture(args):
    return run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).strip()


def api(path):
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPOSITORY}/{path}",
        headers={"Accept": "application/vnd.github+json", "User-Agent": "codexdentist-deploy"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def eligible(sha, main, runs):
    return bool(re.fullmatch(r"[0-9a-f]{40}", sha)) and sha == main and any(
        r.get("head_sha") == sha and r.get("head_branch") == "main"
        and r.get("event") == "push" and r.get("status") == "completed"
        and r.get("conclusion") == "success" and r.get("path") == ".github/workflows/ci.yml"
        for r in runs
    )


def replace_image(text, image):
    """Change exactly one image in the existing two-space Compose service block."""
    if not re.fullmatch(r"codexdentist:[a-z0-9-]+", image):
        raise ValueError("Invalid image reference")
    pattern = r"(?m)^  codexdentist:[ \t]*\r?\n(?:(?:^    [^\r\n]*|^[ \t]*)\r?\n)*"
    blocks = list(re.finditer(pattern, text))
    if len(blocks) != 1:
        raise ValueError("Expected one codexdentist service")
    block = blocks[0]
    updated, count = re.subn(r"(?m)^(    image:)[^\r\n]*", rf"\1 {image}", block.group())
    if count != 1:
        raise ValueError("Expected one service image")
    return text[:block.start()] + updated + text[block.end():]


def compose(*args, override=None):
    command = ["docker", "compose", "--project-directory", str(COMPOSE.parent), "-f", str(COMPOSE)]
    if override:
        command += ["-f", str(override)]
    return command + list(args)


def write_atomic(path, content):
    temporary = path.with_name(path.name + ".new")
    temporary.write_bytes(content)
    os.chmod(temporary, path.stat().st_mode & 0o777 if path.exists() else 0o600)
    temporary.replace(path)


def check_migrations(source, previous):
    # CI has the broader expand/contract checker. Unattended deployments accept
    # only new CREATE statements; anything else requires an operator review.
    changed = capture(["git", "-C", str(source), "diff", "--name-status",
                       f"{previous}..HEAD", "--", "prisma/migrations"])
    for line in changed.splitlines():
        status, path = line.split("\t", 1)
        if not path.endswith("/migration.sql"):
            continue
        if status != "A":
            raise RuntimeError("Existing migration changed; operator review required")
        sql = (source / path).read_text()
        sql = re.sub(r"/\*.*?\*/|--[^\r\n]*", " ", sql, flags=re.S)
        for statement in filter(str.strip, sql.split(";")):
            if not re.match(r"^\s*CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX|TYPE|SEQUENCE)\s", statement, re.I):
                raise RuntimeError("Migration requires an operator review")


def health(base):
    headers = {"Host": "codexdentist.com", "User-Agent": "codexdentist-production-health"}
    for route in ["/api/health", "/", "/signup", "/login", "/features",
                  "/api/odontogram-assets/11-adult-crown.svg"]:
        request = urllib.request.Request(base + route, headers=headers)
        with urllib.request.urlopen(request, timeout=20) as response:
            if response.status != 200 or not response.read(1):
                raise RuntimeError("Route verification failed")
    request = urllib.request.Request(base + "/api/health", headers=headers)
    with urllib.request.urlopen(request, timeout=20) as response:
        body = json.load(response)
    if any(body.get(key) != "ok" for key in ["status", "database", "schema"]):
        raise RuntimeError("Database/schema health failed")


def wait_health(base):
    for attempt in range(45):
        try:
            health(base)
            return
        except Exception:
            if attempt == 44:
                raise
            time.sleep(2)


def restore_drill(backup, image, name):
    run(["docker", "run", "-d", "--name", name, "--network", "none",
         "--tmpfs", "/var/lib/postgresql/data:rw,size=1g",
         "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"], stdout=subprocess.DEVNULL)
    try:
        for attempt in range(30):
            ready = subprocess.run(["docker", "exec", name, "pg_isready", "-U", "postgres"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if ready.returncode == 0:
                break
            time.sleep(2)
        else:
            raise RuntimeError("Restore database did not start")
        with (backup / "database.dump").open("rb") as dump:
            run(["docker", "exec", "-i", name, "pg_restore", "--exit-on-error", "--no-owner",
                 "--no-acl", "-U", "postgres", "-d", "postgres"], stdin=dump)
        run(["docker", "run", "--rm", "--network", f"container:{name}",
             "-e", "DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres",
             "--entrypoint", "npx", image, "prisma", "migrate", "deploy"])
        (backup / "restore-verified").write_text("backup restored; candidate migrations applied\n")
    finally:
        run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL)


def deploy(sha, main):
    marker = ROOT / "needs-attention.json"
    if marker.exists():
        raise RuntimeError("Unresolved deployment marker; inspect before retrying")
    current = json.loads(capture(["docker", "inspect", CONTAINER]))[0]
    if (current["Config"].get("Labels") or {}).get(REVISION) == sha:
        print("Already running verified main", sha, flush=True)
        health("http://127.0.0.1:3100")
        return
    # Verify target identity without exposing any production secret.
    environment = dict(item.split("=", 1) for item in current["Config"]["Env"])
    from urllib.parse import urlparse
    database = urlparse(environment.get("DATABASE_URL", ""))
    if database.hostname != "nc-migration-postgres" or database.path != "/" + DATABASE:
        raise RuntimeError("Unexpected production database; aborting")
    source = ROOT / "releases" / sha
    if not source.exists():
        run(["git", "clone", "--no-checkout", f"https://github.com/{REPOSITORY}.git", str(source)])
        run(["git", "-C", str(source), "checkout", "--detach", sha])
    if capture(["git", "-C", str(source), "rev-parse", "HEAD"]) != sha or capture(
        ["git", "-C", str(source), "status", "--porcelain"]
    ):
        raise RuntimeError("Release checkout is not clean or has wrong identity")
    previous = (current["Config"].get("Labels") or {}).get(REVISION)
    if not previous:
        raise RuntimeError("Initial deployment must establish a reviewed revision first")
    # Check the full migration range since the deployed version, not only last commit.
    check_migrations(source, previous)
    image = f"codexdentist:{sha}"
    with (ROOT / f"build-{sha}.log").open("ab") as log:
        run(["docker", "build", "--label", f"{REVISION}={sha}", "-t", image, str(source)],
            stdout=log, stderr=subprocess.STDOUT)
    # A newer main or an API failure aborts before backup/migration/cutover.
    if api("git/ref/heads/main")["object"]["sha"] != main:
        raise RuntimeError("Main changed while building; defer to next run")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = ROOT / "backups" / f"{stamp}-{sha[:12]}"
    backup.mkdir(mode=0o700)
    for path in [COMPOSE, COMPOSE.parent / ".env", COMPOSE.parent / "env"]:
        if path.is_dir():
            shutil.copytree(path, backup / path.name)
        elif path.exists():
            shutil.copy2(path, backup / path.name)
    (backup / "previous-image-id").write_text(current["Image"] + "\n")
    rollback = f"codexdentist:rollback-{stamp.lower()}"
    run(["docker", "tag", current["Image"], rollback])
    with (backup / "database.dump").open("wb") as dump:
        run(["docker", "exec", POSTGRES, "sh", "-c",
             'pg_dump -U "$POSTGRES_USER" -Fc --dbname ' + DATABASE], stdout=dump)
    restore_drill(backup, image, "codexdentist-restore-" + stamp.lower())
    old_config = COMPOSE.read_bytes()
    new_config = replace_image(old_config.decode(), image).encode()
    override = backup / "candidate.json"
    override.write_text(json.dumps({"services": {"codexdentist": {"image": image}}}))
    write_atomic(marker, json.dumps({"sha": sha, "backup": str(backup), "rollback": rollback}).encode())
    candidate = "codexdentist-release-check"
    cutover = False
    try:
        if api("git/ref/heads/main")["object"]["sha"] != main:
            raise RuntimeError("Main changed before migration; defer release")
        run(compose("run", "--rm", "--no-deps", "-T", "--entrypoint", "npx", "codexdentist",
                    "prisma", "migrate", "deploy", override=override))
        run(compose("run", "-d", "--no-deps", "--name", candidate, "-p", "127.0.0.1::3000",
                    "--entrypoint", "node", "codexdentist", "node_modules/next/dist/bin/next", "start",
                    "-H", "0.0.0.0", "-p", "3000", override=override), stdout=subprocess.DEVNULL)
        endpoint = capture(["docker", "port", candidate, "3000/tcp"])
        if not re.fullmatch(r"127\.0\.0\.1:[0-9]+", endpoint):
            raise RuntimeError("Candidate is not bound exclusively to loopback")
        wait_health("http://" + endpoint)
        if api("git/ref/heads/main")["object"]["sha"] != main:
            raise RuntimeError("Main changed before cutover; defer release")
        write_atomic(COMPOSE, new_config)
        cutover = True
        run(compose("up", "-d", "--no-deps", "--pull", "never", "codexdentist"))
        wait_health("http://127.0.0.1:3100")
        for _ in range(3):
            health("https://codexdentist.com")
            time.sleep(5)
        deployed = json.loads(capture(["docker", "inspect", CONTAINER]))[0]
        if (deployed["Config"].get("Labels") or {}).get(REVISION) != sha:
            raise RuntimeError("Running image identity mismatch")
        write_atomic(ROOT / "current.json", json.dumps({"sha": sha, "backup": str(backup), "time": stamp}).encode())
        marker.unlink()
        print("Deployment verified", sha, flush=True)
    except Exception:
        if cutover:
            # Keep the additive migration; never automatically restore old data over new writes.
            write_atomic(COMPOSE, replace_image(old_config.decode(), rollback).encode())
            run(compose("up", "-d", "--no-deps", "--pull", "never", "codexdentist"))
            wait_health("http://127.0.0.1:3100")
            print("Previous image restored; deployment marker retained", flush=True)
        raise
    finally:
        # This container has no application data volume; never remove a database volume.
        subprocess.run(["docker", "rm", "-f", candidate], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    import fcntl  # Linux only; pure policy helpers are also tested on Windows.
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sha", help="Optional exact main SHA; still requires successful push CI")
    parser.add_argument("--check", action="store_true", help="Read eligibility without deploying")
    args = parser.parse_args()
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, exist_ok=True)
    for directory in ["releases", "backups"]:
        (ROOT / directory).mkdir(mode=0o700, exist_ok=True)
    with (ROOT / "deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        main_sha = api("git/ref/heads/main")["object"]["sha"]
        sha = args.sha or main_sha
        runs = api(f"actions/runs?head_sha={sha}&event=push&per_page=20")["workflow_runs"]
        if not eligible(sha, main_sha, runs):
            print("No eligible successful main release", flush=True)
            return
        print("Eligible successful main", sha, flush=True)
        if not args.check:
            deploy(sha, main_sha)


if __name__ == "__main__":
    main()
