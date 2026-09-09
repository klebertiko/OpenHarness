import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/* Archivo — an industrial grotesque with real tabular figures and tight
   display tracking. Chosen against Inter/Geist precisely because those are
   the defaults every generated dashboard already wears. */
const ui = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui",
  display: "swap",
});

/* JetBrains Mono carries every machine-written string: ids, model names,
   latencies, keycaps. Humans get the grotesque; machines get the mono. */
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "OpenHarness",
  description: "Build, wire and run agent harnesses on your own subscriptions.",
};

export const viewport: Viewport = {
  themeColor: "#0a0c11",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
