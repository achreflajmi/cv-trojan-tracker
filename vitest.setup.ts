// Load .env for tests that need DATABASE_URL (database tests skip without it).
// Nothing from .env is printed.
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
