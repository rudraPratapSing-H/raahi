import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    'anytime-saggy-debtor.ngrok-free.dev',
    // add any other ngrok domains here if they change
  ],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:8000/api/:path*', // Proxy to Backend
      },
      {
        source: '/wearable',
        destination: 'http://127.0.0.1:8000/wearable', // Proxy to Backend's static wearable/voice app
      },
      {
        source: '/wearable/:path*',
        destination: 'http://127.0.0.1:8000/wearable/:path*',
      },
    ];
  },
};

export default nextConfig;
