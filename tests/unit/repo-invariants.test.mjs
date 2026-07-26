// ============================================================
// Cross-file invariants
// ============================================================
// Some facts have to be stated in two files that no compiler, linter or test
// otherwise relates. Nothing catches the drift, and the failure modes are
// silent and security-shaped — so they are asserted here.
//
// This file is deliberately *not* about metrics (that is metrics.test.mjs). It
// exists for "these two files must agree" rules.
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('the admin UUID matches between the RLS policy and the client config', () => {
  // supabase/schema.sql's is_admin() is the REAL write boundary — every admin
  // write policy calls it. index.html's SUPABASE_CONFIG.adminUserId only drives
  // UI gating (revealing Data Entry and cloud-save).
  //
  // Drift is silent and confusing in both directions:
  //   client UUID wrong → the admin sees no Data Entry tab, or a non-admin sees
  //     one whose every save is then rejected by RLS;
  //   schema UUID wrong → the intended admin's writes are refused server-side
  //     with the UI still inviting them.
  // Neither raises an error the app can show, so assert it here instead.
  const schema = read('supabase/schema.sql');
  const client = read('index.html');

  const inSchema = schema.match(/auth\.uid\(\)\s*=\s*'([0-9a-f-]{36})'::uuid/i)?.[1];
  const inClient = client.match(/adminUserId:\s*'([0-9a-f-]{36})'/i)?.[1];

  assert.ok(inSchema, 'could not find the admin UUID in public.is_admin() (supabase/schema.sql) — ' +
    'if the policy was restructured, update this test to match');
  assert.ok(inClient, 'could not find adminUserId in SUPABASE_CONFIG (index.html)');
  assert.equal(inClient, inSchema,
    'SUPABASE_CONFIG.adminUserId (index.html) and public.is_admin() (supabase/schema.sql) disagree. ' +
    'They name the same account: the schema decides who may actually write, the client only decides ' +
    'who is shown the controls. Change both, and re-run schema.sql against the project.');
});

test('the Supabase config placeholders are either all blank or all filled', () => {
  // Half-configured is the one state with no sensible behaviour: boot() treats
  // url+anonKey as the switch between static and cloud mode, so a filled URL
  // with a blank key gives a page that thinks it is in cloud mode and cannot
  // reach the cloud. Blank (static/demo deployment) and filled are both valid.
  const client = read('index.html');
  const url = client.match(/url:\s*'([^']*)'/)?.[1];
  const anonKey = client.match(/anonKey:\s*'([^']*)'/)?.[1];
  assert.equal(
    Boolean(url) === Boolean(anonKey), true,
    `SUPABASE_CONFIG is half-filled (url: ${url ? 'set' : 'blank'}, anonKey: ${anonKey ? 'set' : 'blank'}). ` +
    'Fill both to enable cloud mode, or blank both for the static/xlsx deployment.',
  );
});
