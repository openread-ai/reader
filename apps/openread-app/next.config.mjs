import { withSentryConfig } from '@sentry/nextjs';
import withSerwistInit from '@serwist/next';
import withBundleAnalyzer from '@next/bundle-analyzer';

const isDev = process.env['NODE_ENV'] === 'development';
const appPlatform = process.env['NEXT_PUBLIC_APP_PLATFORM'];

if (isDev) {
  const { initOpenNextCloudflareForDev } = await import('@opennextjs/cloudflare');
  initOpenNextCloudflareForDev();
}

const exportOutput = appPlatform !== 'web' && !isDev;

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ensure Next.js uses SSG instead of SSR
  // https://nextjs.org/docs/pages/building-your-application/deploying/static-exports
  output: exportOutput ? 'export' : undefined,
  pageExtensions: exportOutput ? ['jsx', 'tsx'] : ['js', 'jsx', 'ts', 'tsx'],
  // Note: This feature is required to use the Next.js Image component in SSG mode.
  // See https://nextjs.org/docs/messages/export-image-api for different workarounds.
  images: {
    unoptimized: true,
  },
  devIndicators: false,
  // Configure assetPrefix or else the server won't properly resolve your assets.
  assetPrefix: '',
  reactStrictMode: true,
  serverExternalPackages: ['isows'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      nunjucks: 'nunjucks/browser/nunjucks.js',
    };
    return config;
  },
  turbopack: {
    resolveAlias: {
      nunjucks: 'nunjucks/browser/nunjucks.js',
    },
  },
  transpilePackages: [
    'ai',
    'ai-sdk-ollama',
    '@ai-sdk/react',
    '@assistant-ui/react',
    '@assistant-ui/react-ai-sdk',
    '@assistant-ui/react-markdown',
    'streamdown',
    ...(isDev
      ? []
      : [
          'i18next-browser-languagedetector',
          'react-i18next',
          'i18next',
          '@tauri-apps',
          'highlight.js',
          'foliate-js',
          'marked',
        ]),
  ],
  async headers() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/json',
          },
        ],
      },
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: isDev
              ? 'public, max-age=0, must-revalidate'
              : 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' *.posthog.com *.sentry.io js.stripe.com cdnjs.cloudflare.com cdn.jsdelivr.net",
              "style-src 'self' 'unsafe-inline' blob: fonts.googleapis.com cdnjs.cloudflare.com cdn.jsdelivr.net storage.openread.com",
              "font-src 'self' blob: data: fonts.gstatic.com cdnjs.cloudflare.com",
              "img-src 'self' data: blob: asset: http://asset.localhost *.supabase.co cdn.openread.com storage.openread.com *.r2.cloudflarestorage.com *.googleusercontent.com",
              "connect-src 'self' blob: asset: http://asset.localhost ipc: http://ipc.localhost http://localhost:3001 *.supabase.co wss://*.supabase.co *.posthog.com *.sentry.io js.stripe.com speech.platform.bing.com *.googleapis.com api.openread.com *.openread.ai *.r2.cloudflarestorage.com lh3.googleusercontent.com",
              "media-src 'self' blob: data:",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "frame-src 'self' js.stripe.com",
              "worker-src 'self' blob:",
            ].join('; '),
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

const pwaDisabled = isDev || appPlatform !== 'web';

const withPWA = pwaDisabled
  ? (config) => config
  : withSerwistInit({
      swSrc: 'src/sw.ts',
      swDest: 'public/sw.js',
      cacheOnNavigation: true,
      reloadOnOnline: true,
      disable: false,
      register: true,
      scope: '/',
    });

const withAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

// Sentry configuration options
const sentryWebpackPluginOptions = {
  // Automatically upload source maps to Sentry
  silent: true, // Suppresses all logs
  org: process.env['SENTRY_ORG'],
  project: process.env['SENTRY_PROJECT'],
  authToken: process.env['SENTRY_AUTH_TOKEN'],

  // Only upload source maps in CI or when explicitly enabled
  dryRun: !process.env['SENTRY_AUTH_TOKEN'],

  // Hide source maps from public
  hideSourceMaps: true,

  // Disable telemetry
  telemetry: false,

  // Don't wipe source maps after upload
  widenClientFileUpload: true,
};

// Wrap with Sentry as outermost wrapper (only if DSN is provided)
const config = withPWA(withAnalyzer(nextConfig));
const shouldUseSentry = process.env['NEXT_PUBLIC_SENTRY_DSN'];

export default shouldUseSentry
  ? withSentryConfig(config, sentryWebpackPluginOptions)
  : config;
