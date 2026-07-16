import type { NextConfig } from "next";

// Minimal no-regret security headers. NOTE: Permissions-Policy must keep `microphone=(self)` —
// the dashboard test call and the landing live demo use getUserMedia on this origin.
// No CSP here (needs nonce plumbing in Next; separate task).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // /public/media holds the CONTENT-HASHED hero video (built by
        // scripts/prepare-hero-video.mjs — the hash is in the filename). Because
        // the URL changes whenever the bytes change, it is safe to cache
        // immutably: the browser downloads the clip once and reuses it across
        // visits, and a new encode busts the cache automatically. We only apply
        // `immutable` here (hashed names) — never to stable /public/videos/* names.
        source: "/media/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
