/**
 * Applies db/schema.sql to the database named by DATABASE_URL.
 *
 * This is the only place in the project that uses the Postgres connection
 * string, and it runs on your machine, never in the browser or on Vercel.
 *
 *   npm run db:migrate
 *
 * The script is idempotent -- every statement uses IF NOT EXISTS, CREATE OR
 * REPLACE, or a preceding DROP -- so re-running it after an edit is safe.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');

config({ path: join(projectRoot, '.env.local') });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error(
    'DATABASE_URL is not set.\n\n' +
      'Copy .env.example to .env.local and paste the connection string from\n' +
      'the Neon Console (Dashboard -> Connect).',
  );
  process.exit(1);
}

const schemaPath = join(projectRoot, 'db', 'schema.sql');
const schema = readFileSync(schemaPath, 'utf8');

/**
 * Splits a SQL script into individual statements.
 *
 * Neon's HTTP driver sends each call as a prepared statement, which accepts
 * exactly one command, so the script has to be split before sending. Splitting
 * on ';' alone would cut the plpgsql function body in half, so this walks the
 * text and ignores semicolons inside quotes, comments, and $$-quoted blocks.
 */
function splitStatements(sqlText) {
  const statements = [];
  let current = '';
  let index = 0;

  while (index < sqlText.length) {
    const rest = sqlText.slice(index);

    // Line comment: skip to end of line.
    if (rest.startsWith('--')) {
      const newline = sqlText.indexOf('\n', index);
      index = newline === -1 ? sqlText.length : newline;
      continue;
    }

    // Block comment: skip to the closing marker.
    if (rest.startsWith('/*')) {
      const close = sqlText.indexOf('*/', index + 2);
      index = close === -1 ? sqlText.length : close + 2;
      continue;
    }

    // Dollar-quoted string, e.g. $$ ... $$ or $tag$ ... $tag$.
    const dollarTag = /^\$[A-Za-z_]*\$/.exec(rest);
    if (dollarTag) {
      const tag = dollarTag[0];
      const close = sqlText.indexOf(tag, index + tag.length);
      const end = close === -1 ? sqlText.length : close + tag.length;
      current += sqlText.slice(index, end);
      index = end;
      continue;
    }

    // Single- or double-quoted literal. '' and "" are escapes, and because the
    // doubled quote is consumed as a fresh opening quote the scan resumes
    // correctly either way.
    const char = sqlText[index];
    if (char === "'" || char === '"') {
      let end = index + 1;
      while (end < sqlText.length && sqlText[end] !== char) end += 1;
      end = Math.min(end + 1, sqlText.length);
      current += sqlText.slice(index, end);
      index = end;
      continue;
    }

    if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

const sql = neon(databaseUrl);
const statements = splitStatements(schema);

console.log(`Applying ${schemaPath} (${statements.length} statements)`);

for (const statement of statements) {
  try {
    await sql.query(statement);
  } catch (error) {
    const firstLine = statement.split('\n')[0].slice(0, 80);
    console.error(`\nMigration failed on: ${firstLine}...\n`);
    console.error(error.message);

    if (/schema "auth" does not exist|function auth\.user_id/i.test(error.message)) {
      console.error(
        '\nauth.user_id() comes from Neon Auth. Enable Neon Auth (Managed\n' +
          'Better Auth) on this branch in the Neon Console, then run this again.',
      );
    }
    process.exit(1);
  }
}

console.log('Schema applied.');

// Report what actually landed, so a successful run is verifiable rather than
// just silent.
const [{ count: policyCount }] = await sql`
  select count(*)::int as count
  from pg_policies
  where schemaname = 'public' and tablename = 'contacts'
`;

const [{ rls }] = await sql`
  select relrowsecurity as rls
  from pg_class
  where oid = 'public.contacts'::regclass
`;

console.log(`Row Level Security enabled: ${rls}`);
console.log(`Policies on public.contacts: ${policyCount}`);

if (!rls || policyCount < 4) {
  console.error('\nExpected RLS enabled and 4 policies. Something is wrong.');
  process.exit(1);
}
