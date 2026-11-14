import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/language-switcher";
import { withBasePath } from "@/lib/base-path";

/** Shared chrome for both login modes: logo, card, language switcher. */
export function LoginShell({
  description,
  children,
}: {
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Image
            src={withBasePath("/logo.png")}
            alt="Hindsight"
            width={160}
            height={160}
            className="mx-auto"
            unoptimized
          />
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}