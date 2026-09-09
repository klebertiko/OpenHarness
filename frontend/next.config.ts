import type { NextConfig } from "next";

const BACKEND =
  process.env.OPENHARNESS_BACKEND_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev overlay badge floats over the app's own bottom-left corner, where
  // the canvas controls live. Off, so the shell's chrome is the only chrome.
  devIndicators: { buildActivity: false, appIsrStatus: false },
  // Same-origin `/bundles/*`, `/providers/*`, `/cowork/*`, `/automations/*`
  // for the client. Mirrors the `/api/run` proxy rule: the webview must not
  // call :8000 directly.
  async rewrites() {
    return [
      {
        source: "/bundles/:path*",
        destination: `${BACKEND}/bundles/:path*`,
      },
      {
        source: "/providers/:path*",
        destination: `${BACKEND}/providers/:path*`,
      },
      {
        source: "/cowork/:path*",
        destination: `${BACKEND}/cowork/:path*`,
      },
      {
        source: "/automations/:path*",
        destination: `${BACKEND}/automations/:path*`,
      },
    ];
  },
};

export default nextConfig;
