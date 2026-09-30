import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  outputFileTracingIncludes: {
    "/v1/estimates/extract-text": [
      "./node_modules/pdf-parse/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
    ]
  },
  reactStrictMode: true,
  serverExternalPackages: ["@napi-rs/canvas", "pdf-parse"],
  turbopack: {
    root: path.join(__dirname, "../..")
  }
};

export default nextConfig;
