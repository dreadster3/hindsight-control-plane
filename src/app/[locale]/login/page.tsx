import { Suspense } from "react";
import { isOidcEnabled } from "@/lib/auth/oidc-config";
import { LoginForm } from "./login-form";
import { OidcLogin } from "./oidc-login";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const returnTo = typeof params.returnTo === "string" ? params.returnTo : undefined;

  return (
    <Suspense>
      {isOidcEnabled() ? <OidcLogin returnTo={returnTo} /> : <LoginForm />}
    </Suspense>
  );
}