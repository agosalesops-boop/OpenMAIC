import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.VERCEL ? undefined : 'standalone',
  outputFileTracingIncludes: {
    '/*': [
      'lib/server/agent-runtime/import-pptx-worker.mjs',
      'skills/openmaic/**',
      'skills/agent-runtime/**',
      // sharp's native linux-x64 binaries live inside pnpm's symlinked
      // .pnpm store; Vercel's build-time file tracer does not reliably
      // follow that symlink chain for native addons, so ERR_DLOPEN_FAILED
      // happens at runtime even though the packages are correctly
      // resolved in pnpm-lock.yaml. Force-include them explicitly.
      'node_modules/.pnpm/@img+sharp-linux-x64@*/node_modules/@img/sharp-linux-x64/**',
      'node_modules/.pnpm/@img+sharp-libvips-linux-x64@*/node_modules/@img/sharp-libvips-linux-x64/**',
    ],
  },
  typescript: {
    tsconfigPath: process.env.NODE_ENV === 'production' ? 'tsconfig.build.json' : 'tsconfig.json',
  },
  transpilePackages: ['mathml2omml', 'pptxgenjs', '@openmaic/importer'],
  // These agent packages do a runtime `import(specifier)` with a computed
  // specifier (to lazily load node:fs/os/path without breaking browser/Vite
  // builds). webpack can't statically analyze that and bundling it throws
  // "Cannot find module as expression is too dynamic" at runtime on the server
  // (the "Edit with AI" Pro-mode path), which broke the #619 keep-alive e2e.
  // Mark them server-external so Next loads them natively and the dynamic
  // import resolves as a real Node call.
  serverExternalPackages: [
    'sharp',
    '@earendil-works/pi-ai',
    '@earendil-works/pi-agent-core',
    '@openmaic/generation',
    // Optional peers of @openmaic/storage, reached through deliberately
    // untraced dynamic imports. Externalizing keeps them out of the bundle,
    // and the static anchor in lib/persistence/asset-byte-store.ts gets them
    // traced into the standalone image -- without it, S3 mode and redirect
    // egress cannot resolve their SDK in the shipped deployment.
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
  ],
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
  async headers() {
    const extraAncestors = process.env.ALLOWED_FRAME_ANCESTORS?.trim();
    const frameAncestors = extraAncestors ? `'self' ${extraAncestors}` : "'self'";

    return [
      {
        source: '/(.*)',
        headers: [
          // X-Frame-Options only supports SAMEORIGIN (no allow-list),
          // so we omit it when custom ancestors are configured.
          ...(!extraAncestors ? [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }] : []),
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${frameAncestors}`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
