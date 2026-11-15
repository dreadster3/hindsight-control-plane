#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Next.js standalone uses HOSTNAME both to bind and as the origin its locale
// rewrite is checked against; a literal loopback address makes every page 307 to
// itself (#1926). Bind as `localhost` instead, pinning Node's DNS order so the
// address family stays the one requested. Mirrors docker/standalone/start-all.sh.
function resolveBindHost(hostname, nodeOptions) {
  const family = { '127.0.0.1': 'ipv4first', '::1': 'ipv6first', '[::1]': 'ipv6first' }[hostname];
  if (!family) return { hostname, nodeOptions };
  return {
    hostname: 'localhost',
    nodeOptions: [nodeOptions, `--dns-result-order=${family}`].filter(Boolean).join(' '),
  };
}

// The documented names are HINDSIGHT_CP_*, but Next's standalone server only
// reads bare PORT/HOSTNAME and the container image pre-sets both, so the aliases
// must be resolved here and win over them.
function resolveBindTarget(env) {
  return {
    port: env.HINDSIGHT_CP_PORT || env.PORT || 9999,
    hostname: env.HINDSIGHT_CP_HOSTNAME || env.HOSTNAME || '0.0.0.0',
  };
}

module.exports = { resolveBindHost, resolveBindTarget };

if (require.main === module) {
  main();
}

function main() {
const args = process.argv.slice(2);

// Parse command line arguments
let { port, hostname } = resolveBindTarget(process.env);
let apiUrl = process.env.HINDSIGHT_CP_DATAPLANE_API_URL;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' || args[i] === '-p') {
    port = args[++i];
  } else if (args[i] === '--hostname' || args[i] === '-H') {
    hostname = args[++i];
  } else if (args[i] === '--api-url' || args[i] === '-a') {
    apiUrl = args[++i];
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
Hindsight Control Plane

Usage: hindsight-control-plane [options]

Options:
  -p, --port <port>       Port to listen on (default: 9999, env: HINDSIGHT_CP_PORT)
  -H, --hostname <host>   Hostname to bind to (default: 0.0.0.0, env: HINDSIGHT_CP_HOSTNAME)
  -a, --api-url <url>     Hindsight API URL (env: HINDSIGHT_CP_DATAPLANE_API_URL)
  -h, --help              Show this help message

Environment Variables:
  HINDSIGHT_CP_PORT                 Port to listen on (default: 9999)
  HINDSIGHT_CP_HOSTNAME             Hostname to bind to (default: 0.0.0.0)
  PORT                              Fallback port, only when HINDSIGHT_CP_PORT is unset
  HOSTNAME                          Fallback hostname, only when HINDSIGHT_CP_HOSTNAME is unset
  HINDSIGHT_CP_DATAPLANE_API_URL    URL of the Hindsight API server

Flags beat environment variables, HINDSIGHT_CP_* beat the bare fallbacks.
`);
    process.exit(0);
  }
}

// Find the standalone server: the published package keeps it in standalone/,
// the container image lays it at the root with bin/ beside it.
const serverPath = [
  path.join(__dirname, '..', 'standalone', 'server.js'),
  path.join(__dirname, '..', 'server.js'),
].find((candidate) => fs.existsSync(candidate));

if (!serverPath) {
  console.error('Error: Standalone server not found next to', __dirname);
  console.error('This package may not have been built correctly.');
  process.exit(1);
}
const standaloneDir = path.dirname(serverPath);

// Set up environment
const bind = resolveBindHost(hostname, process.env.NODE_OPTIONS);
const env = {
  ...process.env,
  PORT: String(port),
  HOSTNAME: bind.hostname,
};
if (bind.nodeOptions) {
  env.NODE_OPTIONS = bind.nodeOptions;
}

if (apiUrl) {
  env.HINDSIGHT_CP_DATAPLANE_API_URL = apiUrl;
}

console.log(`Starting Hindsight Control Plane on http://${hostname}:${port}`);
if (apiUrl) {
  console.log(`API URL: ${apiUrl}`);
}

// Run the standalone server
const server = spawn('node', [serverPath], {
  cwd: standaloneDir,
  env,
  stdio: 'inherit',
  // On Windows a console-less parent (PM2, services) would otherwise give the
  // child its own visible console window; logs still flow via inherited stdio.
  windowsHide: true,
});

server.on('error', (err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});

server.on('close', (code) => {
  process.exit(code || 0);
});

// Handle signals
process.on('SIGTERM', () => server.kill('SIGTERM'));
process.on('SIGINT', () => server.kill('SIGINT'));
}
