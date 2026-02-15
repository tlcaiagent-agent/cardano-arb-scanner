/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['lucid-cardano', 'node-fetch'],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Don't bundle these - let Node resolve them at runtime
      config.externals = config.externals || []
    }
    // Fix for WASM used by lucid-cardano
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    }
    return config
  },
}
module.exports = nextConfig
