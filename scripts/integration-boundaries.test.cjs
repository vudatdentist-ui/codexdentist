const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./audit-source-loader.cjs");

test("integration mutations accept only the request origin under the configured proxy policy", () => {
  for (const proxy of ["none", "reverse-proxy"]) {
    const { hasSameOrigin } = load("src/lib/request-security.ts", {
      "@/lib/env": { trustedProxyProvider: () => proxy },
    });
    const request = headers => new Request("http://127.0.0.1:3000/api/integrations/connections", { headers });
    assert.equal(hasSameOrigin(request({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" })), true);
    for (const origin of ["https://attacker.test", "null", "file://localhost", "http://127.0.0.1:9999"]) {
      assert.equal(hasSameOrigin(request({ host: "127.0.0.1:3000", origin })), false);
    }
    assert.equal(hasSameOrigin(request({ host: "127.0.0.1:3000" })), false);
    const forwarded = request({ host: "127.0.0.1:3000", origin: "https://codexdentist.com",
      "x-forwarded-host": "codexdentist.com", "x-forwarded-proto": "https" });
    assert.equal(hasSameOrigin(forwarded), proxy !== "none");
    assert.equal(hasSameOrigin(request({ host: "127.0.0.1:3000", origin: "https://codexdentist.com",
      "x-forwarded-host": "codexdentist.com", "x-forwarded-proto": "ftp" })), false);
  }
});

test("provider configuration cannot read arbitrary environment credential prefixes", () => {
  const env = { NODE_ENV: "production", DEPLOYMENT_MODE: "hosted",
    PAYOS_DEFAULT_CLIENT_ID: "client", PAYOS_DEFAULT_API_KEY: "key", PAYOS_DEFAULT_CHECKSUM_KEY: "checksum",
    DOCUMENSO_DEFAULT_API_TOKEN: "token", DOCUMENSO_DEFAULT_WEBHOOK_SECRET: "secret",
    OTHER_TENANT_API_KEY: "private" };
  const config = load("src/integrations/config.ts", {}, { process: { env } });
  for (const resolver of [config.resolvePayOSConnectionSecrets, config.resolveDocumensoConnectionSecrets, config.resolveOrthancConnectionSecrets]) {
    for (const reference of [null, "OTHER_TENANT", "env:OTHER_TENANT", "env:AUTH_SECRET", "env:PAYOS_DEFAULT\n"]) {
      assert.throws(() => resolver(reference));
    }
  }
  assert.equal(config.resolvePayOSConnectionSecrets("env:PAYOS_DEFAULT").clientId, "client");
  assert.equal(config.resolveDocumensoConnectionSecrets("env:DOCUMENSO_DEFAULT").apiToken, "token");
  env.PAYOS_DEFAULT_BASE_URL = "http://merchant.test";
  assert.throws(() => config.resolvePayOSConnectionSecrets("env:PAYOS_DEFAULT"));
  env.DEPLOYMENT_MODE = "self-hosted";
  env.ORTHANC_DEFAULT_BASE_URL = "ftp://pacs.test";
  assert.throws(() => config.resolveOrthancConnectionSecrets("env:ORTHANC_DEFAULT"));
});

test("readiness requires job authorization even outside production", async () => {
  let queried = false;
  const { GET } = load("src/app/api/readiness/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/job-auth": { verifyJobRequest: () => false },
    "@/lib/prisma": { prisma: { $queryRaw: async () => { queried = true; } } },
  }, { process: { env: { NODE_ENV: "test" } } });
  const response = await GET(new Request("http://localhost/api/readiness"));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(queried, false);
});
