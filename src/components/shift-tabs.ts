/** The shift portal's pages, shared with the header so tablets and desktops get them too. */
export const SHIFT_TABS: { href: string; label: string; icon: string; exact?: boolean }[] = [
  { href: '/app', label: 'Shift', icon: 'M3 11l9-7 9 7v9H3z', exact: true },
  { href: '/app/today', label: 'Today', icon: 'M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1' },
  { href: '/app/deliveries', label: 'Receive', icon: 'M3 7h13v10H3zM16 10h3l2 3v4h-5M7 18h.01M18 18h.01' },
  { href: '/app/board', label: 'Board', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { href: '/app/scan', label: 'Scan', icon: 'M4 6v12M8 6v12M11 6v12M15 6v12M18 6v12M20 6v12' },
];
