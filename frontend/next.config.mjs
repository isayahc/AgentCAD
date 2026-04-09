/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Enable Turbopack (default in Next.js 16)
  turbopack: {},
  experimental: {
    // Enable server external packages for WASM
    serverExternalPackages: ['occt-import-js'],
  },
}

export default nextConfig
