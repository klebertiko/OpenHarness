import type { Metadata, Viewport } from "next";
import { Sora, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/* Sora — geometric UI face that stays crisp at 12–14px in dense chrome.
   Chosen against Inter/Geist (dashboard default) and Archivo (too industrial
   at small sizes). Locked in design.md. */
const ui = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ui",
  display: "swap",
});

/* IBM Plex Mono — machine strings: ids, chords, latencies, adapter names. */
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OpenHarness",
  description: "Agent desktop with a portable harness — design, validate, run.",
};

export const viewport: Viewport = {
  // Matches --sub-000 in each theme (globals.css) — dark is the default.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "oklch(0.170 0.006 72)" },
    { media: "(prefers-color-scheme: light)", color: "oklch(0.965 0.008 82)" },
  ],
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
