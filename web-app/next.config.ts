import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    'anytime-saggy-debtor.ngrok-free.dev',
    // add any other ngrok domains here if they change
    '10.17.242.124',
    // ^ LAN IP for phone testing over `next dev` - this changes whenever the
    // laptop reconnects to Wi-Fi/gets a new DHCP lease, so update it here
    // (or check `ipconfig`) if phone access to HMR/dev assets stops working.
    // The app itself still loads without this entry; only Fast Refresh
    // (hot reload) is blocked for an origin that isn't listed.
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
