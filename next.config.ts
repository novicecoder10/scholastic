import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Emits a self-contained server bundle in `.next/standalone`, which the
   * container image copies instead of shipping node_modules. `next start` and
   * `pnpm dev` are unaffected.
   */
  output: "standalone",
};

export default nextConfig;
