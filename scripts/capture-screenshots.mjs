/**
 * Captures the README's screenshot evidence from the live app.
 *
 *   npm run screenshots              # opens Edge; you sign in, the rest is automatic
 *   npm run screenshots -- --dry-run # headless, captures only the sign-in screen
 *
 * Signing in is left to the person running this. The script never reads or
 * fills the email or password fields -- it waits until the dashboard appears.
 * Everything after that (adding sample contacts, triggering a validation error,
 * editing, refreshing, deleting, signing out) is driven here, and each step is
 * saved to docs/screenshots/.
 *
 * Email addresses shown in the header are blurred before every capture, since
 * these images are committed to a public repository.
 *
 * Uses the locally installed Microsoft Edge via playwright-core, so no browser
 * binary is downloaded.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(projectRoot, 'docs', 'screenshots');
const LOG_FILE = join(projectRoot, '..', 'screenshots-log.txt');
const APP_URL = process.env.APP_URL ?? 'https://networking-tracker-vert.vercel.app';
const DRY_RUN = process.argv.includes('--dry-run');
const WAIT_FOR_HUMAN = 15 * 60_000;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(LOG_FILE, '');

function log(message) {
  console.log(message);
  appendFileSync(LOG_FILE, `${message}\n`);
}

const browser = await chromium.launch({ channel: 'msedge', headless: DRY_RUN });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  colorScheme: 'light',
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);

const signOutButton = page.getByRole('button', { name: 'Sign out' });
const saved = [];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Waits for any contact-list fetch to finish so a capture is never mid-load. */
async function settle() {
  await page.waitForTimeout(150);
  await page.getByText('Loading your contacts…').waitFor({ state: 'hidden' });
  await page.waitForTimeout(400);
}

async function redact() {
  await page.evaluate(() => {
    const blur = (element) => {
      element.style.filter = 'blur(6px)';
    };
    // The signed-in user's email in the header.
    document.querySelectorAll('header p').forEach(blur);
    // Email inputs only when they hold an address -- blurring an empty field
    // would just smudge the placeholder and make the form look broken.
    document
      .querySelectorAll('input[type="email"]')
      .forEach((input) => input.value && blur(input));
  });
}

async function shot(name) {
  await redact();
  const path = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path });
  saved.push(`${name}.png`);
  log(`  saved ${name}.png`);
}

/** A banner in the Edge window telling the person what to do. Never captured. */
async function showBanner(text) {
  await page.evaluate((message) => {
    const banner = document.createElement('div');
    banner.id = 'screenshot-helper-banner';
    banner.textContent = message;
    Object.assign(banner.style, {
      position: 'fixed',
      left: '0',
      right: '0',
      bottom: '0',
      padding: '14px 20px',
      background: '#1d4ed8',
      color: '#fff',
      font: '600 15px system-ui, sans-serif',
      textAlign: 'center',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });
    document.body.appendChild(banner);
  }, text);
}

async function hideBanner() {
  await page.evaluate(() => document.getElementById('screenshot-helper-banner')?.remove());
}

async function addContact(contact) {
  await page.getByRole('button', { name: 'Add contact', exact: true }).click();
  await page.locator('#contact-name').fill(contact.name);
  await page.locator('#contact-company').fill(contact.company);
  await page.locator('#contact-role').fill(contact.role);
  await page.locator('#contact-where').fill(contact.whereMet);
  await page.locator('#contact-notes').fill(contact.notes);
  await page.locator('#contact-priority').selectOption(contact.priority);
  await page.getByRole('button', { name: 'Add contact', exact: true }).click();
  await page.getByText(`Added ${contact.name}.`).waitFor();
  await settle();
}

// Rows are matched through getByRole, which ignores hidden elements. Each
// contact is rendered twice -- a table row for desktop and a card for phones --
// and at desktop width the card is in the DOM but hidden, so a plain text
// match can land on the invisible copy and wait for it forever.
function row(name) {
  return page.getByRole('row').filter({ hasText: name }).first();
}

const SAMPLE_NAMES = ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'];

/**
 * Deletes sample contacts left behind by an earlier run on this account, so a
 * re-run captures a clean list instead of duplicates. Only contacts with these
 * sample names are touched.
 */
async function removeSampleContacts() {
  for (const name of SAMPLE_NAMES) {
    while ((await page.getByRole('row').filter({ hasText: name }).count()) > 0) {
      log(`  removing leftover sample contact: ${name}`);
      await row(name).getByRole('button', { name: 'Delete' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await settle();
    }
  }
}

async function currentUserLabel() {
  return (await page.locator('header p').first().textContent())?.trim();
}

/* -------------------------------------------------------------------------- */
/* Run                                                                        */
/* -------------------------------------------------------------------------- */

try {
  log(`Capturing screenshots from ${APP_URL}`);
  log(`Saving to ${OUT_DIR}\n`);

  await page.goto(APP_URL);
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await shot('01-sign-in');

  if (DRY_RUN) {
    log('\nDry run complete.');
    await browser.close();
    process.exit(0);
  }

  /* ---------------------------------------------------------------------- */
  log('\n>>> ACTION NEEDED: in the Edge window, sign in (or create an account).');
  log('>>> Everything after that is automatic -- just watch.\n');
  await showBanner('Sign in or create an account here. The screenshots after that are automatic.');
  await signOutButton.waitFor({ timeout: WAIT_FOR_HUMAN });
  await hideBanner();
  await settle();
  const firstUser = await currentUserLabel();
  log('Signed in.');
  await removeSampleContacts();
  log('Capturing the contact workflow...');

  /* ---------------------------------------------------------------------- */
  // Invalid input: submit the form with a blank name.
  await page.getByRole('button', { name: 'Add contact', exact: true }).click();
  await page.getByRole('button', { name: 'Add contact', exact: true }).click();
  await page.getByText('Name is required.').waitFor();
  await shot('02-invalid-input-rejected');
  await page.getByRole('button', { name: 'Cancel' }).click();

  /* ---------------------------------------------------------------------- */
  await addContact({
    name: 'Ada Lovelace',
    company: 'Analytical Engines',
    role: 'Mathematician',
    whereMet: 'Berkeley AI mixer',
    notes: 'Follow up about her notes on the Analytical Engine.',
    priority: 'high',
  });
  await shot('03-contact-created');

  await addContact({
    name: 'Grace Hopper',
    company: 'U.S. Navy',
    role: 'Computer Scientist',
    whereMet: 'Career fair, MLK Student Union',
    notes: 'Ask about compiler internships.',
    priority: 'medium',
  });
  await addContact({
    name: 'Alan Turing',
    company: 'University of Manchester',
    role: 'Mathematician',
    whereMet: 'Soda Hall guest lecture',
    notes: '',
    priority: 'low',
  });

  /* ---------------------------------------------------------------------- */
  // Sort by priority, highest first.
  await page.locator('#sort-field').selectOption('priority_rank');
  await settle();
  await page.getByRole('button', { name: 'Sort ascending' }).click();
  await settle();
  await shot('04-sorted-by-priority');

  // Filter to high priority only.
  await page.locator('#filter-priority').selectOption('high');
  await settle();
  await shot('05-filtered-high-priority');
  await page.locator('#filter-priority').selectOption('all');
  await settle();

  /* ---------------------------------------------------------------------- */
  await row('Grace Hopper').getByRole('button', { name: 'Edit' }).click();
  await page.locator('#contact-role').fill('Rear Admiral');
  await shot('06-editing-contact');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Updated Grace Hopper.').waitFor();
  await settle();
  await shot('07-contact-edited');

  /* ---------------------------------------------------------------------- */
  // Refresh: the edit must still be there, because it lives in Postgres.
  await page.reload();
  await signOutButton.waitFor();
  await settle();
  await page.getByRole('cell', { name: 'Rear Admiral' }).waitFor();
  await shot('08-after-browser-refresh');

  /* ---------------------------------------------------------------------- */
  await row('Alan Turing').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').waitFor();
  await shot('09-delete-confirmation');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await page.getByText('Deleted Alan Turing.').waitFor();
  await settle();
  await shot('10-contact-deleted');

  /* ---------------------------------------------------------------------- */
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  await shot('11-mobile-layout');
  await page.setViewportSize({ width: 1280, height: 800 });
  await settle();

  /* ---------------------------------------------------------------------- */
  await signOutButton.click();
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();
  await shot('12-signed-out');

  /* ---------------------------------------------------------------------- */
  log('\n>>> ACTION NEEDED: create a SECOND account with a DIFFERENT email.');
  log('>>> This shows the second account cannot see the first account\'s contacts.\n');
  await showBanner('Now create a SECOND account with a different email.');

  let secondUser = firstUser;
  while (secondUser === firstUser) {
    await signOutButton.waitFor({ timeout: WAIT_FOR_HUMAN });
    await settle();
    secondUser = await currentUserLabel();
    if (secondUser === firstUser) {
      log('That is the same account as before. Sign out and create a new one with a different email.');
      await signOutButton.waitFor({ state: 'hidden', timeout: WAIT_FOR_HUMAN });
    }
  }
  await hideBanner();

  const leaked = await page.getByRole('row').filter({ hasText: 'Ada Lovelace' }).count();
  await shot('13-second-account-sees-none');
  log(
    leaked === 0
      ? '  PASS  the second account sees none of the first account\'s contacts'
      : '  FAIL  the second account can see the first account\'s contacts',
  );

  await signOutButton.click();
  await page.getByRole('heading', { name: 'Sign in' }).waitFor();

  log(`\nDone. ${saved.length} screenshots saved.`);
  await browser.close();
  process.exit(leaked === 0 ? 0 : 1);
} catch (error) {
  const failurePath = join(tmpdir(), 'networking-tracker-screenshot-failure.png');
  await redact().catch(() => {});
  await page.screenshot({ path: failurePath }).catch(() => {});
  log(`\nScreenshot run failed: ${error.message}`);
  log(`Saved so far: ${saved.join(', ') || 'none'}`);
  log(`Page at the moment of failure: ${failurePath}`);
  await browser.close();
  process.exit(1);
}
