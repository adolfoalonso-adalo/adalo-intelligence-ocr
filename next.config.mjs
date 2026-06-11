/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  serverExternalPackages: [
    "@google-cloud/documentai",
    "@napi-rs/canvas",
    "pdf-parse",
    "sharp",
  ],
};

export default nextConfig;
