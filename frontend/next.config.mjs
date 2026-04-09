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
    // Allow the proxy to wait up to 5 minutes for the backend to respond.
    // The CAD agent can be slow (LLM calls + code generation + retries).
    proxyTimeout: 300_000,
  },
  // Proxy /api requests to the FastAPI backend so the browser never makes a
  // cross-origin request.  The backend URL can be overridden with the
  // BACKEND_URL environment variable (defaults to http://localhost:8000).
  async rewrites() {
    const backend = process.env.BACKEND_URL || 'http://localhost:8000'
    return [
      {
        source: '/api/:path*',
        destination: `${backend}/:path*`,
      },
    ]
  },
}

export default nextConfig
