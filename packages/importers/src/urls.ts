import type { ImportVendor } from './types.js';

/** X-URL-1: deep links come from a fixed vendor template plus an id that cannot carry a scheme, host or path. */
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

const TEMPLATES: Readonly<Record<'chatgpt' | 'claude' | 'claude_project' | 'gemini', string>> = {
  chatgpt: 'https://chatgpt.com/c/',
  claude: 'https://claude.ai/chat/',
  claude_project: 'https://claude.ai/project/',
  gemini: 'https://gemini.google.com/app/',
};

export function conversationUrl(kind: Exclude<ImportVendor, 'paste'> | 'claude_project', id: string): string | null {
  return SAFE_ID.test(id) ? TEMPLATES[kind] + id : null;
}
