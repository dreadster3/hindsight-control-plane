// Proves Next applies the proxy matcher at runtime. The unit tests import the
// exported `config` object, so a matcher that never runs (the F-06 bypass) is
// invisible to them. Builds the app, starts `next start` on a loopback port with
// an access key set, and checks the gates over real HTTP. No deployment and no
// dataplane: an anonymous /api/health reports "auth-required" without probing.
//
// Not part of `npm test` (vitest only collects tests/**/*.test.ts[x]).
// Run: npm run test:integration
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NEXT = path.join(ROOT, "node_modules/next/dist/bin/next");

async function freePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function waitFor(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await fetch(url).then((res) => res.ok, () => false);
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not answer within ${timeoutMs}ms`);
}

async function stop(server) {
  if (!server || server.exitCode !== null) return;
  // Detached: kill the group so a wrapper process cannot orphan the server.
  process.kill(-server.pid, "SIGTERM");
  const exited = await Promise.race([
    once(server, "exit").then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
  ]);
  if (exited) return;
  process.kill(-server.pid, "SIGKILL");
  await once(server, "exit");
}

test("proxy gates extension-suffixed api paths over real http", { timeout: 900_000 }, async () => {
  assert.ok(existsSync(NEXT), `next cli not found at ${NEXT} — run npm install`);

  const port = await freePort();
  const distDir = path.join(ROOT, `.next-${port}`);
  const env = {
    // Drop ambient OIDC config so the run is deterministically in access-key
    // mode: any AUTH_* trio would flip isOidcEnabled() and the gates would 401
    // for a different reason.
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AUTH_"))),
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    // A key is what makes the gate exist at all (no key = open mode).
    HINDSIGHT_CP_ACCESS_KEY: "integration-test-access-key",
    HINDSIGHT_CP_PORT: String(port),
  };

  // Turbopack refuses a worktree whose node_modules is a symlink, so webpack.
  const build = spawnSync(process.execPath, [NEXT, "build", "--webpack"], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: 600_000,
  });
  assert.equal(build.status, 0, `next build failed:\n${build.stdout}\n${build.stderr}`);

  const server = spawn(process.execPath, [NEXT, "start", "-p", String(port)], {
    cwd: ROOT,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (chunk) => (log += chunk));
  server.stderr.on("data", (chunk) => (log += chunk));

  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(`${base}/api/health`);

    // 1-5: an asset-looking last segment must not skip the proxy's 401.
    const gated = [
      ["GET", "/api/banks.json"],
      ["PATCH", "/api/memories/test.json"],
      ["GET", "/api/stats/default.json"],
      ["GET", "/api/knowledge-banks/x.json"],
      ["GET", "/api/banks/x.js"],
    ];
    for (const [method, pathname] of gated) {
      const res = await fetch(`${base}${pathname}`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "PATCH" ? JSON.stringify({ content: "x" }) : undefined,
      });
      assert.equal(res.status, 401, `${method} ${pathname} must be gated`);
      assert.equal(res.headers.get("x-hindsight-session-required"), "1", `${pathname} header`);
      // A handler-401 is byte-identical, so require the proxy's own stamp: only
      // proxy() adds the CSP header, and only proxy() proves the matcher ran.
      assert.ok(
        res.headers.get("content-security-policy-report-only"),
        `${method} ${pathname} must be answered by the proxy, not a handler`
      );
    }

    // 6-7: the public probe says a session is needed and leaks no topology.
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200, "GET /api/health stays public");
    const healthBody = await health.json();
    assert.equal(healthBody.dataplane?.status, "auth-required");
    assert.doesNotMatch(JSON.stringify(healthBody), /url|hindsight-api|:8888/i, "health leaks topology");

    // 8: the CSP is Report-Only, nonce-based, and not yet enforced.
    const login = await fetch(`${base}/login`);
    assert.equal(login.status, 200, "GET /login stays public");
    const csp = login.headers.get("content-security-policy-report-only");
    assert.match(csp ?? "", /script-src 'self' 'nonce-[^']+'/, "login must carry the nonce CSP");
    assert.equal(login.headers.get("content-security-policy"), null, "CSP must not be enforced yet");
  } finally {
    await stop(server);
    rmSync(distDir, { recursive: true, force: true });
  }

  // No orphan: the port must be closed once the server is gone.
  const stillServing = await fetch(`${base}/api/health`).then(() => true, () => false);
  assert.equal(stillServing, false, `server still answering after teardown:\n${log}`);
});
