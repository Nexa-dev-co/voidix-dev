/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @voidix/content ships raw TypeScript rather than a compiled dist, so Next has to run it through
  // its own pipeline. Keeps the shared schema a single source with no build step between editing it
  // and seeing it here.
  transpilePackages: ['@voidix/content'],
};

export default nextConfig;
