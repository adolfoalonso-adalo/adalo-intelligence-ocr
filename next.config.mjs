import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: {
    "/api/ocr/process": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "sharp"],
};

export default nextConfig;
