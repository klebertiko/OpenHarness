import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev overlay badge floats over the app's own bottom-left corner, where
  // the canvas controls live. Off, so the shell's chrome is the only chrome.
  devIndicators: { buildActivity: false, appIsrStatus: false },
};

export default nextConfig;
