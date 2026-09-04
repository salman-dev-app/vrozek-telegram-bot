/**
 * VROZEK AI — local setup helper.
 * Usage:  node scripts/setup.js <WORKER_URL>   (e.g. https://vrozek-ai.yourname.workers.dev)
 * Calls /setup with the webhook URL header, then prints the checks you still need.
 */

const workerUrl = process.argv[2];
if (!workerUrl) {
  console.error('Usage: node scripts/setup.js <WORKER_URL>');
  console.error('Example: node scripts/setup.js https://vrozek-ai.yourname.workers.dev');
  process.exit(1);
}

const url = workerUrl.replace(/\/$/, '');

async function main() {
  console.log('Calling /setup on', url);
  const res = await fetch(`${url}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-setup-url': `${url}/webhook` },
    body: '{}',
  });
  console.log('Status:', res.status);
  console.log(await res.text());
  console.log('\nDone. Next steps:');
  console.log(' 1. Open the Admin Dashboard: ' + `${url}/dashboard`);
  console.log(' 2. Add your group ID (see @getidsbot) under Groups.');
  console.log(' 3. Add products & knowledge, then ask the bot in any language.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
