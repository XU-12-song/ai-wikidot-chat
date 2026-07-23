import OpenAI from 'openai';

export const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
export const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

if (!DEEPSEEK_API_KEY) {
  console.error('ERROR: DEEPSEEK_API_KEY is not set. Create a .env file with your key:\n  DEEPSEEK_API_KEY=sk-your-key-here');
  process.exit(1);
}

export const THINKING_ENABLED = { type: 'enabled' };

export function createOpenAIClient() {
  return new OpenAI({ apiKey: DEEPSEEK_API_KEY, baseURL: DEEPSEEK_BASE_URL });
}
