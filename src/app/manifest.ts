import type { MetadataRoute } from 'next';

/**
 * Installing to the home screen is not cosmetic here: iOS only delivers Web Push to a PWA
 * that has been installed, so without this the morning digest simply never arrives on an
 * iPhone. start_url points at the shift screen because that is what a staff member opens.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ShelfLife',
    short_name: 'ShelfLife',
    description: 'Track what arrives, know what expires.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f1113',
    theme_color: '#0f1113',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
