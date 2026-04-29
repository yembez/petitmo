import { runPublicMediaWorkerOnce } from './publicMediaWorkerOnce';

async function main(): Promise<void> {
  const r = await runPublicMediaWorkerOnce();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(r));
}

void main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

