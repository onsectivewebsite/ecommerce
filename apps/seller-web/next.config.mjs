/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@onsective/ui', '@onsective/api-client', '@onsective/shared-types'],
};
export default nextConfig;
