import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use webpack for PDF.js worker configuration
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Disable PDF.js worker files for server-side rendering
      config.resolve.alias = {
        ...config.resolve.alias,
        'pdfjs-dist/build/pdf.worker.mjs': false,
        'pdfjs-dist/build/pdf.worker.min.mjs': false,
      };
      // Ignore worker-related modules
      config.resolve.fallback = {
        ...config.resolve.fallback,
        canvas: false,
        fs: false,
      };
    }
    return config;
  },
  // Empty turbopack config to silence warning (we're using webpack)
  turbopack: {},
};

export default nextConfig;
