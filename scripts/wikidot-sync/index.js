import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

import { scheduler } from "./scheduler.service.js";
import { main as resolveIframes } from "./resolve-iframes.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../..', '.env') });

await scheduler({ SITE_NAME: process.env.SITE_NAME });

await resolveIframes();

process.exit();