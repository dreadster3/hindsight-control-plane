import localFont from "next/font/local";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { BankProvider } from "@/lib/bank-context";
import { FeaturesProvider } from "@/lib/features-context";
import { ThemeProvider } from "@/lib/theme-context";
import { Toaster } from "@/components/ui/sonner";
import { withBasePath } from "@/lib/base-path";

// Inter preloaded server-side so every weight (400/500/600/700) is ready
// before paint. The Google Fonts @import this replaces loaded weights lazily,
// which made semibold headings render in the system fallback until the weight
// arrived. --font-sans / --font-mono are consumed by globals.css.
// The files are the Google Fonts latin variable subsets, checked in so the
// build never downloads them (next/font/google did, and failed CI when the
// fetch flaked, #5765).
const inter = localFont({
  src: "../fonts/inter-latin.woff2",
  weight: "400 700",
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: "../fonts/jetbrains-mono-latin.woff2",
  weight: "400 500",
  variable: "--font-mono",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Anti-FOUC: public/theme-init.js applies the theme's `.dark` class before
// first paint. It is a static file (CSP needs no inline-script exception) and,
// as the first <body> child, runs synchronously before the content paints.

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground">
        {/* Blocking on purpose: it must set the theme class before first paint. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src={withBasePath("/theme-init.js")} />
        <ThemeProvider>
          <FeaturesProvider>
            <BankProvider>
              <NextIntlClientProvider>{children}</NextIntlClientProvider>
            </BankProvider>
          </FeaturesProvider>
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
