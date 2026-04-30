import type { NextConfig } from "next";

const config: NextConfig = {
  // typedRoutes intentionally off: admin pages land in separate PRs and the
  // strict Route<> check rejects forward-looking nav links until the target
  // route is on disk. Re-enable once all admin routes are in main.
  serverExternalPackages: ["jsforce", "postgres"],
};

export default config;
