import { getTranslations } from "next-intl/server";
import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { sanitizeReturnTo, withBasePath } from "@/lib/base-path";
import { LoginShell } from "./login-shell";

/**
 * OIDC login (Authentik): one button that starts the authorization-code + PKCE
 * flow via NextAuth. After the IdP round-trip the user lands on returnTo with
 * a session cookie whose token scopes every dataplane call to their own banks.
 */
export async function OidcLogin({ returnTo }: { returnTo?: string }) {
  const t = await getTranslations("login");
  // Sanitize before it ever reaches the IdP redirect; keep the app basePath.
  const target = withBasePath(sanitizeReturnTo(returnTo));

  return (
    <LoginShell description={t("oidcDescription")}>
      <form
        action={async () => {
          "use server";
          await signIn("authentik", { redirectTo: target });
        }}
      >
        <Button type="submit" className="w-full">
          {t("signInWithOidc")}
        </Button>
      </form>
    </LoginShell>
  );
}