import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server is bound to every interface. Browsers that open it as 127.0.0.1
  // (rather than localhost) must be allowed or client components never hydrate.
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
