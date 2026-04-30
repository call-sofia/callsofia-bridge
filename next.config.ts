import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    typedRoutes: true,
  },
  serverExternalPackages: ["jsforce", "postgres"],
};

export default config;
