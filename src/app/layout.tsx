import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { TopNav } from "@/components/nav/TopNav";
import { isAuthEnabled } from "@/lib/auth/config";
import { verifySession } from "@/lib/auth/dal";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Scholastic — AI-native academic discovery",
    template: "%s — Scholastic",
  },
  description:
    "Search OpenAlex, Semantic Scholar, Crossref, PubMed, arXiv, CORE, Europe PMC, DOAJ, and Unpaywall in one unified, deduplicated result list.",
};

/** Reserves the navbar's height during prerender: TopNav reads the query string
 * (useSearchParams), so it renders on the client. */
function TopNavFallback() {
  return <div className="border-line bg-nav h-14 border-b" />;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolved here rather than inside TopNav so the nav renders the right
  // identity on first paint. verifySession() is wrapped in React cache(), so a
  // page that also checks the session costs one lookup for the whole render.
  const user = await verifySession();
  const authEnabled = isAuthEnabled();

  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="bg-page text-ink flex min-h-full flex-col">
        <Suspense fallback={<TopNavFallback />}>
          <TopNav user={user} authEnabled={authEnabled} />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
