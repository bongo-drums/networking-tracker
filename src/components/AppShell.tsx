'use client';

import { getNeonClient, isNeonConfigured } from '@/lib/neon';
import { AuthScreen } from './AuthScreen';
import { ContactsDashboard } from './ContactsDashboard';
import { Card, Notice, Spinner } from './ui';

/**
 * Decides which screen the visitor sees, based on whether Neon Auth reports a
 * session.
 *
 * This is a convenience boundary, not a security boundary. Rendering the
 * dashboard does not grant access to any data: every Data API request is
 * filtered by the RLS policies in db/schema.sql, so a signed-out visitor who
 * forced this component to render the dashboard would simply see nothing.
 */
export function AppShell() {
  if (!isNeonConfigured()) {
    return <ConfigurationError />;
  }

  return <SessionGate />;
}

function SessionGate() {
  const client = getNeonClient();
  const { data: session, isPending } = client.auth.useSession();

  if (isPending) {
    return (
      <main className="flex flex-1 items-center justify-center p-8">
        <Spinner label="Checking your session…" />
      </main>
    );
  }

  if (!session?.user) {
    return <AuthScreen />;
  }

  return (
    <ContactsDashboard
      userLabel={session.user.email ?? session.user.name ?? 'Signed in'}
      onSignOut={async () => {
        await client.auth.signOut();
      }}
    />
  );
}

function ConfigurationError() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <Card className="p-6">
        <Notice tone="error">
          This app is not configured yet.
        </Notice>
        <p className="mt-4 text-sm text-muted">
          Copy <code className="font-mono text-foreground">.env.example</code> to{' '}
          <code className="font-mono text-foreground">.env.local</code> and set{' '}
          <code className="font-mono text-foreground">NEXT_PUBLIC_NEON_AUTH_URL</code> and{' '}
          <code className="font-mono text-foreground">NEXT_PUBLIC_NEON_DATA_API_URL</code> from the
          Neon Console, then restart the dev server.
        </p>
      </Card>
    </main>
  );
}
