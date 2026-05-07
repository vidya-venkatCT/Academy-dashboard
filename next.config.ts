import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_HUBSPOT_PORTAL_ID: process.env.HUBSPOT_PORTAL_ID ?? "23982969",
  },
};

export default nextConfig;
