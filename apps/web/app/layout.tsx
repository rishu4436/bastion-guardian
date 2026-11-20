import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";
import { EnvironmentBanner, Nav } from "@/components/nav";

export const metadata: Metadata = {
  title: { default: "BASTION Guardian", template: "%s · BASTION Guardian" },
  description: "Autonomous, non-custodial cross-chain liquidation protection powered by Reactive Network.",
};

// Runtime configuration (API origin) is injected per request so one build serves any environment.
export const dynamic = "force-dynamic";

const themeScript = `try{var t=localStorage.getItem("bastion-theme");if(!t){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  const apiUrl = process.env.BASTION_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: `window.__BASTION__=${JSON.stringify({ apiUrl })}` }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <Providers>
          <EnvironmentBanner />
          <Nav />
          <main className="mx-auto max-w-7xl px-6 py-10">{children}</main>
          <footer className="mx-auto max-w-7xl px-6 pb-10 text-xs text-muted">
            Readiness indicators are not a guarantee of rescue success. BASTION never takes custody of your
            collateral; rescues execute only within limits you sign.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
