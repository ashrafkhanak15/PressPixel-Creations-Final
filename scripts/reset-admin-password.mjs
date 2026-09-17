import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { hashAdminPassword, isValidAdminEmail, normalizeAdminEmail, passwordValidationError } from '../lib/admin-auth.ts';
import { closeDb, getDb } from '../db/index.ts';

async function hiddenPrompt(label) {
  if (!stdin.isTTY || !stdin.setRawMode) throw new Error('Password reset requires an interactive terminal.');
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => { stdin.off('data', onData); stdin.setRawMode(false); stdin.pause(); stdout.write('\n'); };
    const onData = (key) => {
      if (key === '\u0003') { cleanup(); reject(new Error('Password reset cancelled.')); return; }
      if (key === '\r' || key === '\n') { cleanup(); resolve(value); return; }
      if (key === '\u007f' || key === '\b') { if (value) { value = value.slice(0, -1); stdout.write('\b \b'); } return; }
      if (/^[\x20-\x7E]$/.test(key)) { value += key; stdout.write('*'); }
    };
    stdin.on('data', onData);
  });
}

const rl = readline.createInterface({ input: stdin, output: stdout });
try {
  const suggested = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim() || '';
  const email = normalizeAdminEmail(await rl.question(`Admin email${suggested ? ` [${suggested}]` : ''}: `) || suggested);
  if (!isValidAdminEmail(email)) throw new Error('Enter a valid administrator email.');
  rl.close();
  const password = await hiddenPrompt('New password: ');
  const validationError = passwordValidationError(password);
  if (validationError) throw new Error(validationError);
  const confirmation = await hiddenPrompt('Confirm password: ');
  if (password !== confirmation) throw new Error('Passwords do not match.');
  const hash = await hashAdminPassword(password);
  const [result] = await getDb().execute('UPDATE admin_users SET password_hash = ? WHERE email = ? AND is_active = 1', [hash, email]);
  if (result.affectedRows !== 1) throw new Error('Active administrator not found.');
  await getDb().execute('DELETE FROM admin_sessions');
  console.log('Administrator password reset and all existing sessions revoked.');
} finally {
  rl.close();
  await closeDb();
}
