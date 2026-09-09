'use client';

import { useState } from 'react';
import { getNeonClient } from '@/lib/neon';
import { Button, Card, Field, Input, Notice } from './ui';

type Mode = 'sign-in' | 'sign-up';

/**
 * Sign in / sign up. Neon Auth (Managed Better Auth) owns the credentials --
 * this component only collects them and reports back what the service said.
 * No password is ever stored or logged here.
 */
export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSignUp = mode === 'sign-up';

  function switchMode() {
    setMode(isSignUp ? 'sign-in' : 'sign-up');
    setError(null);
    setPassword('');
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (isSignUp && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const auth = getNeonClient().auth;

      const { error: authError } = isSignUp
        ? await auth.signUp.email({ email, password, name: name.trim() || email })
        : await auth.signIn.email({ email, password });

      if (authError) {
        setError(authError.message ?? 'Could not sign you in. Check your details and try again.');
        return;
      }

      // On success the useSession() hook in AppShell picks up the new session
      // and swaps this screen for the dashboard.
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not reach the authentication service. Check your connection and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Networking Tracker
        </h1>
        <p className="mt-2 text-sm text-muted">
          Keep track of the people you want to stay connected with at Berkeley.
        </p>
      </div>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground">
          {isSignUp ? 'Create your account' : 'Sign in'}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {isSignUp
            ? 'Your contacts are private to your account.'
            : 'Welcome back.'}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
          {error && <Notice tone="error">{error}</Notice>}

          {isSignUp && (
            <Field label="Name" htmlFor="name">
              <Input
                id="name"
                name="name"
                autoComplete="name"
                placeholder="Your name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          )}

          <Field label="Email" htmlFor="email" required>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@berkeley.edu"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field
            label="Password"
            htmlFor="password"
            required
            hint={isSignUp ? 'At least 8 characters.' : undefined}
          >
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <Button type="submit" disabled={submitting} className="mt-2">
            {submitting
              ? isSignUp
                ? 'Creating account…'
                : 'Signing in…'
              : isSignUp
                ? 'Create account'
                : 'Sign in'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted">
          {isSignUp ? 'Already have an account?' : 'New here?'}{' '}
          <button
            type="button"
            onClick={switchMode}
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            {isSignUp ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </Card>
    </main>
  );
}
