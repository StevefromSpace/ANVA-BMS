// Usage: node users-cli.js add <user> <role> | passwd <user> | remove <user> | list
// Password is read from stdin (piped) or a hidden prompt; never from argv.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { hashPassword, ROLES } from './auth.js';

const FILE = process.env.USERS_FILE || fileURLToPath(new URL('./users.json', import.meta.url));
const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')).users ?? [] : []);
const save = (users) => { writeFileSync(`${FILE}.tmp`, JSON.stringify({ users }, null, 2), { mode: 0o600 }); renameSync(`${FILE}.tmp`, FILE); };

async function readPassword() {
  if (!process.stdin.isTTY) { let s = ''; for await (const c of process.stdin) s += c; return s.split(/\r?\n/)[0]; }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (t) => { if (t.includes('Password')) process.stdout.write(t); };   // hide typed characters
  const p = await new Promise((r) => rl.question('Password: ', r)); rl.close(); process.stdout.write('\n');
  return p;
}
const goodPw = (p) => typeof p === 'string' && p.length >= 10;

const [cmd, name, role] = process.argv.slice(2);
const users = load();
try {
  if (cmd === 'list') users.forEach((u) => console.log(`${u.username}\t${u.role}`));
  else if (cmd === 'add' || cmd === 'passwd') {
    if (!name) throw new Error(`usage: ${cmd} <username>${cmd === 'add' ? ' <viewer|operator|admin>' : ''}`);
    const i = users.findIndex((u) => u.username === name);
    if (cmd === 'add' && (i >= 0 || !ROLES.includes(role))) throw new Error(i >= 0 ? 'user exists' : `role must be one of ${ROLES.join('|')}`);
    if (cmd === 'passwd' && i < 0) throw new Error('unknown user');
    const pw = await readPassword();
    if (!goodPw(pw)) throw new Error('password must be at least 10 characters');
    const rec = { username: name, role: cmd === 'add' ? role : users[i].role, ...hashPassword(pw) };
    save(i >= 0 ? users.map((u, k) => (k === i ? rec : u)) : [...users, rec]);
    console.log(`${cmd === 'add' ? 'added' : 'updated'} ${name}`);
  } else if (cmd === 'remove') {
    if (!users.some((u) => u.username === name)) throw new Error('unknown user');
    save(users.filter((u) => u.username !== name)); console.log(`removed ${name}`);
  } else throw new Error('usage: add <user> <role> | passwd <user> | remove <user> | list');
} catch (e) { console.error(e.message); process.exit(1); }
