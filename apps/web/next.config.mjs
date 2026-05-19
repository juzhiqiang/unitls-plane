/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@utils-plane/db',
    '@utils-plane/validators',
    '@utils-plane/api-client',
    '@utils-plane/utils',
  ],
};

export default nextConfig;