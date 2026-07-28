/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Both shared packages ship raw TypeScript rather than a compiled dist.
  transpilePackages: ['@voidix/content', '@voidix/database'],
};

export default nextConfig;
