import './src/config.js';  // validates DEEPSEEK_API_KEY, exits if missing

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import conversations from './src/routes/conversations.js';
import chat from './src/routes/chat.js';
import branches from './src/routes/branches.js';
import messages from './src/routes/messages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Mount API routes
app.use('/api/conversations', conversations);
app.use('/api/conversations', chat);
app.use('/api/conversations', branches);
app.use('/api/conversations', messages);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
