/**
 * Next.js instrumentation file - runs exactly once at server startup.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  const dataplaneUrl = process.env.HINDSIGHT_CP_DATAPLANE_API_URL || "http://localhost:8888";
  const apiKey = process.env.HINDSIGHT_CP_DATAPLANE_API_KEY || "";
  const oidc = Boolean(
    process.env.AUTH_AUTHENTIK_ISSUER &&
      process.env.AUTH_AUTHENTIK_ID &&
      process.env.AUTH_AUTHENTIK_SECRET &&
      process.env.AUTH_SECRET
  );

  console.log(`[Control Plane] Connecting to dataplane at: ${dataplaneUrl}`);
  if (oidc) {
    console.log("[Control Plane] OIDC login enabled (Authentik) — dataplane calls use per-user tokens");
  } else if (apiKey) {
    console.log("[Control Plane] Using API key authentication");
  } else {
    console.log("[Control Plane] No API key configured (public access)");
  }

  // The dataplane credential above is not the UI gate: say which one the proxy
  // and the API handlers actually enforce. Access-key mode shares one dataplane
  // key across every caller, so a gate bypass there is full data exposure.
  const gate = oidc ? "OIDC" : process.env.HINDSIGHT_CP_ACCESS_KEY ? "access key" : "none (open)";
  console.log(`[Control Plane] UI auth mode: ${gate}`);
}
