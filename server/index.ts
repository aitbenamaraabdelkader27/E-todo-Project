import { createApp } from './app.js';
import { db } from './db.js';

if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.');
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be a valid TCP port.');

const app = createApp();
try {
  await db.$connect();
} catch {
  console.error('Could not connect to PostgreSQL. Check DATABASE_URL and database availability.');
  process.exit(1);
}
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`E-Todo Flow API listening on port ${port}`);
});
function shutdown() {
  server.close(() => {
    void db.$disconnect().then(() => process.exit(0));
  });
  setTimeout(() => {
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
