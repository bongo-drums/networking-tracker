import { AppShell } from '@/components/AppShell';

/**
 * The session lives in a cookie read by the Neon Auth client in the browser, so
 * this page is rendered per-request rather than prerendered at build time --
 * otherwise the first paint would be a cached "signed out" shell for everyone.
 */
export const dynamic = 'force-dynamic';

export default function Home() {
  return <AppShell />;
}
