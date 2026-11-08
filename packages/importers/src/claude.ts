import type { NormalizedConversation, UserTurn } from './types.js';
import { cleanText, dedupeKey, field, isRecord, str, tail } from './text.js';
import { isoToMs } from './time.js';
import { conversationUrl } from './urls.js';

export const CLAUDE_MEMORY_CONVERSATION_ID = 'claude-memory';

/** Text of a chat message: `text` blocks of `content[]` when present, else the legacy `text` field. */
function messageText(message: Record<string, unknown>): string {
  const content = field(message, 'content');
  if (Array.isArray(content)) {
    const blocks = content
      .filter(isRecord)
      // thinking, tool_use, tool_result and token_budget blocks are not things the user said.
      .filter((block) => str(block, 'type') === 'text')
      .map((block) => str(block, 'text') ?? '')
      .filter((text) => text.length > 0);
    if (blocks.length > 0) return cleanText(blocks.join('\n\n'));
  }
  return cleanText(str(message, 'text') ?? '');
}

/** Parses one element of Claude `conversations.json`. */
export function parseClaudeConversation(raw: unknown, fallbackMs: number): NormalizedConversation | null {
  if (!isRecord(raw)) return null;
  const id = str(raw, 'uuid');
  const messages = field(raw, 'chat_messages');
  if (id === undefined || !Array.isArray(messages)) return null;
  const conversationMs = isoToMs(field(raw, 'created_at')) ?? isoToMs(field(raw, 'updated_at')) ?? fallbackMs;

  const turns: UserTurn[] = [];
  const seen = new Set<string>();
  let lastAssistant: string | undefined;
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const sender = str(message, 'sender');
    const text = messageText(message);
    if (sender === 'assistant') {
      if (text) lastAssistant = text;
      continue;
    }
    if (sender !== 'human' || !text) continue;
    // Edited prompts reappear as sibling messages; the first wording is enough.
    const key = dedupeKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    const turn: UserTurn = { text, at: isoToMs(field(message, 'created_at')) ?? conversationMs };
    if (lastAssistant) turn.assistantContext = tail(lastAssistant);
    turns.push(turn);
  }

  const title = str(raw, 'name');
  return { vendor: 'claude', id, title: title ? cleanText(title) : null, url: conversationUrl('claude', id), turns };
}

/** Project descriptions and instructions are written by the user about their own work. */
export function parseClaudeProjects(raw: unknown, fallbackMs: number): NormalizedConversation[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalizedConversation[] = [];
  for (const project of raw) {
    if (!isRecord(project) || field(project, 'is_starter_project') === true) continue;
    const id = str(project, 'uuid');
    if (id === undefined) continue;
    const at = isoToMs(field(project, 'created_at')) ?? fallbackMs;
    const turns = ['description', 'prompt_template']
      .map((key) => cleanText(str(project, key) ?? ''))
      .filter((text) => text.length > 0)
      .map((text): UserTurn => ({ text, at }));
    if (turns.length === 0) continue;
    const name = cleanText(str(project, 'name') ?? '');
    out.push({
      vendor: 'claude',
      id,
      title: name ? `Project: ${name}` : 'Claude project',
      url: conversationUrl('claude_project', id),
      turns,
    });
  }
  return out;
}

/**
 * `memories.json` is a one-element array holding `conversations_memory` (string) and
 * `project_memories` (project uuid to text). Claude wrote these about the user; they are high-value
 * input for distillation and still go through review like everything else.
 */
export function parseClaudeMemories(raw: unknown, atMs: number): NormalizedConversation[] {
  const records = Array.isArray(raw) ? raw.filter(isRecord) : isRecord(raw) ? [raw] : [];
  const out: NormalizedConversation[] = [];
  const seen = new Set<string>();
  const push = (id: string, title: string, text: string, url: string | null): void => {
    const clean = cleanText(text);
    if (!clean || seen.has(dedupeKey(clean))) return;
    seen.add(dedupeKey(clean));
    out.push({ vendor: 'claude', id, title, url, turns: [{ text: clean, at: atMs }] });
  };
  for (const record of records) {
    push(CLAUDE_MEMORY_CONVERSATION_ID, 'Claude memory', str(record, 'conversations_memory') ?? '', null);
    const projects = field(record, 'project_memories');
    if (!isRecord(projects)) continue;
    for (const [projectId, text] of Object.entries(projects)) {
      if (typeof text !== 'string') continue;
      push(`${CLAUDE_MEMORY_CONVERSATION_ID}-${projectId}`, 'Claude project memory', text, conversationUrl('claude_project', projectId));
    }
  }
  return out;
}
