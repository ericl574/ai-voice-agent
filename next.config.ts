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
    ];
  },
};

export default nextConfig;
