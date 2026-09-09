/**
 * Two-user privacy test.
 *
 * Proves, against the real Neon Auth service and the real Data API, that Row
 * Level Security stops one signed-in user from reading or changing another
 * user's contacts.
 *
 *   npm run test:rls
 *
 * What it does:
 *   1. Creates two throwaway accounts, User A and User B, through the public
 *      Auth API. Emails are randomised per run; passwords are random 32-character
 *      strings that exist only for the duration of the process and are never
 *      printed or written to disk.
 *   2. Signs in as A and creates a contact.
 *   3. Signs in as B and attempts to read, update, and delete A's contact,
 *      and attempts to create a contact stamped with A's user_id.
 *   4. Asserts every one of those attempts fails.
 *   5. Deletes the two test users and A's contact so the database is left as it
 *      was found.
 *
 * This talks to the same public endpoints the browser uses. It holds no
 * database credentials and gets no special privileges -- which is the point:
 * the isolation it demonstrates is enforced by Postgres, not by this script.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: join(projectRoot, '.env.local'), quiet: true });

const AUTH_URL = process.env.NEXT_PUBLIC_NEON_AUTH_URL;
const DATA_API_URL = process.env.NEXT_PUBLIC_NEON_DATA_API_URL;

if (!AUTH_URL || !DATA_API_URL) {
  console.error(
    'Missing NEXT_PUBLIC_NEON_AUTH_URL or NEXT_PUBLIC_NEON_DATA_API_URL.\n' +
      'Copy .env.example to .env.local and fill them in.',
  );
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Tiny assertion harness                                                     */
/* -------------------------------------------------------------------------- */

let passed = 0;
const failures = [];

function check(description, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${description}`);
  } else {
    failures.push(description);
    console.log(`  FAIL  ${description}${detail ? `\n          ${detail}` : ''}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Auth + Data API helpers                                                    */
/* -------------------------------------------------------------------------- */

const strip = (url) => url.replace(/\/$/, '');

/**
 * Neon Auth checks the Origin header against its trusted origins. A browser
 * sets that header automatically; a fetch() from Node does not, so the request
 * is rejected with MISSING_ORIGIN unless we send it ourselves.
 *
 * ORIGIN must be one of the origins trusted by your Neon Auth project. It
 * defaults to the local dev server; override it when testing against a deployed
 * URL, e.g. ORIGIN=https://your-app.vercel.app npm run test:rls
 */
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:3000';

const authHeaders = {
  'content-type': 'application/json',
  origin: ORIGIN,
};

async function signUp(email, password, name) {
  const response = await fetch(`${strip(AUTH_URL)}/sign-up/email`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ email, password, name }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Sign-up failed for ${name} (HTTP ${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function signIn(email, password) {
  const response = await fetch(`${strip(AUTH_URL)}/sign-in/email`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ email, password }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Sign-in failed (HTTP ${response.status}): ${JSON.stringify(body)}`);
  }

  // Two different credentials come back from sign-in and they are not
  // interchangeable:
  //   - a session cookie (Set-Cookie), which is how the auth service itself
  //     recognises the user on later calls, and
  //   - a signed JWT (set-auth-jwt header), which is what the Data API needs,
  //     because Postgres verifies it against the project JWKS to populate
  //     auth.user_id() inside the RLS policies.
  // A browser handles the cookie automatically; fetch() from Node does not,
  // so it is captured and replayed by hand.
  const cookie = (response.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(';')[0])
    .join('; ');

  return {
    sessionToken: body.token ?? null,
    cookie,
    jwt: response.headers.get('set-auth-jwt'),
    userId: body.user?.id,
  };
}

/**
 * Returns the Data API JWT for a signed-in session, asking /get-session for it
 * if sign-in did not include one.
 */
async function jwtFor(session) {
  if (session.jwt) return session.jwt;

  const response = await fetch(`${strip(AUTH_URL)}/get-session`, {
    headers: { ...authHeaders, cookie: session.cookie },
  });

  if (!response.ok) {
    throw new Error(`get-session failed (HTTP ${response.status})`);
  }

  const jwt = response.headers.get('set-auth-jwt');
  if (!jwt) {
    const body = await response.text();
    throw new Error(
      `No set-auth-jwt header on /get-session. Body: ${body.slice(0, 300)}`,
    );
  }

  return jwt;
}

/** Calls the Data API exactly as the browser does: a bearer token, nothing more. */
async function dataApi(path, { token, method = 'GET', body, prefer } = {}) {
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${token}`,
  };
  if (prefer) headers.prefer = prefer;

  const response = await fetch(`${strip(DATA_API_URL)}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return { status: response.status, ok: response.ok, body: parsed };
}

/* -------------------------------------------------------------------------- */
/* Test run                                                                   */
/* -------------------------------------------------------------------------- */

const runId = randomUUID().slice(0, 8);
const userA = {
  email: `rls-test-a-${runId}@example.com`,
  password: randomBytes(24).toString('base64url'),
  name: 'RLS Test User A',
};
const userB = {
  email: `rls-test-b-${runId}@example.com`,
  password: randomBytes(24).toString('base64url'),
  name: 'RLS Test User B',
};

console.log('Two-user privacy test');
console.log(`Auth:     ${strip(AUTH_URL)}`);
console.log(`Data API: ${strip(DATA_API_URL)}`);
console.log(`Test accounts: ${userA.email} / ${userB.email}\n`);

let sessionA;
let sessionB;
let contactId;

try {
  console.log('Setup');
  await signUp(userA.email, userA.password, userA.name);
  await signUp(userB.email, userB.password, userB.name);
  sessionA = await signIn(userA.email, userA.password);
  sessionB = await signIn(userB.email, userB.password);
  sessionA.token = await jwtFor(sessionA);
  sessionB.token = await jwtFor(sessionB);
  console.log(`  Created and signed in both users.`);
  console.log(`  User A id: ${sessionA.userId}`);
  console.log(`  User B id: ${sessionB.userId}\n`);

  /* ---------------------------------------------------------------------- */
  // Preconditions.
  //
  // Without these, a broken token would make every policy check below "pass"
  // for the wrong reason -- B would appear unable to read A's data when in
  // fact B could not authenticate at all. These assert that both users really
  // are talking to the Data API before any conclusion is drawn from a refusal.
  console.log('Preconditions: both users are genuinely authenticated');

  const probeA = await dataApi('/contacts?limit=1', { token: sessionA.token });
  check('A\'s token is accepted by the Data API', probeA.ok, `HTTP ${probeA.status} ${JSON.stringify(probeA.body)}`);

  const probeB = await dataApi('/contacts?limit=1', { token: sessionB.token });
  check('B\'s token is accepted by the Data API', probeB.ok, `HTTP ${probeB.status} ${JSON.stringify(probeB.body)}`);

  if (!probeA.ok || !probeB.ok) {
    throw new Error(
      'Both users must be able to reach the Data API before the privacy ' +
        'checks mean anything. Aborting rather than reporting false passes.',
    );
  }
  console.log('');

  /* ---------------------------------------------------------------------- */
  console.log('User A creates a contact');

  const created = await dataApi('/contacts', {
    token: sessionA.token,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      name: 'Private Contact Of User A',
      company: 'Confidential Inc',
      priority: 'high',
    },
  });

  check('A can insert a contact', created.ok, `HTTP ${created.status} ${JSON.stringify(created.body)}`);

  const row = Array.isArray(created.body) ? created.body[0] : created.body;
  contactId = row?.id;

  check(
    'the new row is stamped with A\'s user_id by the database',
    row?.user_id === sessionA.userId,
    `expected ${sessionA.userId}, got ${row?.user_id}`,
  );

  const readBackA = await dataApi('/contacts', { token: sessionA.token });
  check(
    'A can read back their own contact',
    Array.isArray(readBackA.body) && readBackA.body.some((c) => c.id === contactId),
  );
  console.log('');

  /* ---------------------------------------------------------------------- */
  console.log('User B tries to reach User A\'s contact');

  const bList = await dataApi('/contacts', { token: sessionB.token });
  check(
    'B\'s contact list is empty (SELECT policy)',
    Array.isArray(bList.body) && bList.body.length === 0,
    `got ${JSON.stringify(bList.body)}`,
  );

  const bTargeted = await dataApi(`/contacts?id=eq.${contactId}`, { token: sessionB.token });
  check(
    'B cannot read A\'s contact even when asking for it by id',
    Array.isArray(bTargeted.body) && bTargeted.body.length === 0,
    `got ${JSON.stringify(bTargeted.body)}`,
  );

  const bUpdate = await dataApi(`/contacts?id=eq.${contactId}`, {
    token: sessionB.token,
    method: 'PATCH',
    prefer: 'return=representation',
    body: { name: 'Hacked By User B' },
  });
  // Requires .ok as well as an empty result: the request itself must have been
  // accepted and simply matched no rows. A rejected request would prove
  // nothing about the UPDATE policy.
  check(
    'B cannot update A\'s contact (UPDATE policy)',
    bUpdate.ok && Array.isArray(bUpdate.body) && bUpdate.body.length === 0,
    `HTTP ${bUpdate.status} ${JSON.stringify(bUpdate.body)}`,
  );

  const bDelete = await dataApi(`/contacts?id=eq.${contactId}`, {
    token: sessionB.token,
    method: 'DELETE',
    prefer: 'return=representation',
  });
  check(
    'B cannot delete A\'s contact (DELETE policy)',
    bDelete.ok && Array.isArray(bDelete.body) && bDelete.body.length === 0,
    `HTTP ${bDelete.status} ${JSON.stringify(bDelete.body)}`,
  );

  const bSteal = await dataApi('/contacts', {
    token: sessionB.token,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      name: 'Planted In A\'s List',
      priority: 'low',
      user_id: sessionA.userId,
    },
  });
  // This one must be refused outright. Accept it only if the refusal came from
  // a permission or policy rule -- not from a malformed token, which would be
  // the right answer for the wrong reason.
  const stealMessage = JSON.stringify(bSteal.body ?? '');
  check(
    'B cannot create a contact owned by A (INSERT WITH CHECK / column grant)',
    !bSteal.ok && !/not a valid JWT|authentication/i.test(stealMessage),
    `HTTP ${bSteal.status} ${stealMessage}`,
  );
  console.log('');

  /* ---------------------------------------------------------------------- */
  console.log('User A\'s contact is untouched');

  const afterAttacks = await dataApi(`/contacts?id=eq.${contactId}`, { token: sessionA.token });
  const stillThere = Array.isArray(afterAttacks.body) ? afterAttacks.body[0] : null;
  check('A\'s contact still exists', Boolean(stillThere));
  check(
    'A\'s contact still has its original name',
    stillThere?.name === 'Private Contact Of User A',
    `got ${stillThere?.name}`,
  );
  console.log('');

  /* ---------------------------------------------------------------------- */
  console.log('An unauthenticated request is refused');

  const anonymous = await fetch(`${strip(DATA_API_URL)}/contacts`);
  const anonymousBody = await anonymous.text();
  check(
    'a request with no bearer token cannot read contacts',
    !anonymous.ok || anonymousBody.trim() === '[]',
    `HTTP ${anonymous.status} ${anonymousBody.slice(0, 200)}`,
  );
  console.log('');
} catch (error) {
  console.error(`\nTest aborted: ${error.message}`);
  failures.push(`aborted: ${error.message}`);
} finally {
  /* ---------------------------------------------------------------------- */
  // Leave the database as we found it.
  console.log('Cleanup');

  if (contactId && sessionA?.token) {
    const removed = await dataApi(`/contacts?id=eq.${contactId}`, {
      token: sessionA.token,
      method: 'DELETE',
      prefer: 'return=representation',
    });
    console.log(
      removed.ok ? '  Deleted the test contact.' : '  Could not delete the test contact.',
    );
  }

  for (const [label, session] of [['A', sessionA], ['B', sessionB]]) {
    if (!session?.cookie) continue;
    // delete-user is an auth-service call, so it authenticates with the
    // session cookie -- not the Data API JWT.
    const response = await fetch(`${strip(AUTH_URL)}/delete-user`, {
      method: 'POST',
      headers: { ...authHeaders, cookie: session.cookie },
      body: JSON.stringify({}),
    });
    console.log(
      response.ok
        ? `  Deleted test user ${label}.`
        : `  Could not delete test user ${label} (HTTP ${response.status}) — remove it from the Neon Console if you want a clean user list.`,
    );
  }
}

console.log('');
if (failures.length === 0) {
  console.log(`All ${passed} privacy checks passed.`);
  process.exit(0);
} else {
  console.log(`${passed} passed, ${failures.length} FAILED:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
