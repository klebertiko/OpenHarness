import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
