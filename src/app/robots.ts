import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // The dashboard and auth flows are app surfaces, not content.
        disallow: ['/dashboard', '/api/', '/onboarding', '/confirm/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
