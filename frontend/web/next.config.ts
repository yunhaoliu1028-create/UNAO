import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  reactStrictMode: true,
  serverExternalPackages: ["pdf-parse"],
  turbopack: {
    root: path.join(__dirname, "../..")
  }
};

export default nextConfig;
