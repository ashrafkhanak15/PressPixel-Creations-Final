import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  site: 'https://presspixelcreations.com',
  output: 'static',
  adapter: node({ mode: 'standalone' }),
  trailingSlash: 'never',
  security: { checkOrigin: false },
  prefetch: { prefetchAll: true, defaultStrategy: 'viewport' },
  redirects: {
    '/blog-2': '/journal',
    '/portfolio-2': '/work',
    '/portfolio': '/work',
    '/about-us': '/about',
    '/contact-us': '/contact',
    '/terms-and-conditions': '/terms-of-service',
    '/services/web-development-maintenance': '/services/web-development',
    '/services/online-reputation-management': '/services/content-writing',
    '/2023/07/09/why-small-businesses-need-more-than-just-a-website-in-2026': '/journal/why-small-businesses-need-more-than-just-a-website-in-2026',
  },
  vite: { ssr: { noExternal: ['gsap'] } },
});
