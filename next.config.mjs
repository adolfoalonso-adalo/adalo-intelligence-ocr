/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: process.cwd(),
  poweredByHeader: false,
  serverExternalPackages: ["@google-cloud/documentai", "pdf-parse", "sharp"],
};

export default nextConfig;
