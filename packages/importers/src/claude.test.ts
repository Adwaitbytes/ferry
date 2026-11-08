import { describe, expect, it } from 'vitest';
import { CLAUDE_MEMORY_CONVERSATION_ID, parseClaudeConversation, parseClaudeMemories, parseClaudeProjects } from './claude.js';
import { fixtureJson } from './test-helpers.js';

const NOW = Date.UTC(2026, 10, 9);
const conversations = fixtureJson('claude/conversations.json') as unknown[];

describe('parseClaudeConversation', () => {
  it('reads human text blocks, ignores thinking and tool blocks, and dedupes edits', () => {
    const conversation = parseClaudeConversation(conversations[0], NOW);
    expect(conversation?.turns.map((t) => t.text)).toEqual([
      "I'm a backend engineer at a fictional startup called Example Labs. We decided to use Postgres for everything.",
      'Yes, and I prefer managed services over self hosting.',
    ]);
    expect(conversation?.turns[0]?.at).toBe(Date.parse('2025-03-02T09:15:01Z'));
    expect(conversation?.turns[1]?.assistantContext).toBe('Postgres is a solid default. Do you need full text search?');
    expect(conversation?.url).toBe('https://claude.ai/chat/0f1e2d3c-0000-4000-8000-00000000c001');
  });

  it('falls back to updated_at for a bad created_at and leaves an empty name as null', () => {
    const conversation = parseClaudeConversation(conversations[1], NOW);
    expect(conversation?.title).toBeNull();
    expect(conversation?.turns[0]?.at).toBe(Date.parse('2025-04-10T18:00:05Z'));
    const noTimes = parseClaudeConversation({ uuid: 'u', chat_messages: [{ sender: 'human', text: 'hello you' }] }, NOW);
    expect(noTimes?.turns[0]?.at).toBe(NOW);
  });

  it('returns an empty conversation for no messages and null for unusable input', () => {
    expect(parseClaudeConversation(conversations[2], NOW)?.turns).toEqual([]);
    expect(parseClaudeConversation(conversations[3], NOW)).toBeNull();
    expect(parseClaudeConversation('x', NOW)).toBeNull();
    expect(parseClaudeConversation({ uuid: 'u', chat_messages: 'nope' }, NOW)).toBeNull();
  });
});

describe('parseClaudeProjects', () => {
  it('keeps user-written descriptions and instructions, skipping the starter project', () => {
    const projects = parseClaudeProjects(fixtureJson('claude/projects.json'), NOW);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.title).toBe('Project: SYNTHETIC: Example Labs API');
    expect(projects[0]?.turns.map((t) => t.text)).toEqual([
      'Internal API for the fictional Example Labs. TypeScript, Postgres, deployed on a managed platform.',
      'Always answer in British English and prefer functional TypeScript.',
    ]);
    expect(projects[0]?.url).toBe('https://claude.ai/project/9a8b7c6d-0000-4000-8000-000000000p02');
  });

  it('names untitled projects and tolerates non-arrays', () => {
    expect(parseClaudeProjects({}, NOW)).toEqual([]);
    const [project] = parseClaudeProjects([{ uuid: 'p', description: 'Mine' }], NOW);
    expect(project?.title).toBe('Claude project');
    expect(project?.turns[0]?.at).toBe(NOW);
  });
});

describe('parseClaudeMemories', () => {
  it('turns account and project memory into conversations, never linking unsafe ids', () => {
    const memories = parseClaudeMemories(fixtureJson('claude/memories.json'), NOW);
    expect(memories.map((m) => m.id)).toEqual([
      CLAUDE_MEMORY_CONVERSATION_ID,
      `${CLAUDE_MEMORY_CONVERSATION_ID}-9a8b7c6d-0000-4000-8000-000000000p02`,
      `${CLAUDE_MEMORY_CONVERSATION_ID}-not-a-valid-url-id/../x`,
    ]);
    expect(memories[0]?.turns[0]?.text).toContain('backend engineer');
    expect(memories[1]?.url).toBe('https://claude.ai/project/9a8b7c6d-0000-4000-8000-000000000p02');
    expect(memories[2]?.url).toBeNull();
  });

  it('accepts a bare object, dedupes, and ignores junk', () => {
    expect(parseClaudeMemories({ conversations_memory: 'Same', project_memories: { a: 'same' } }, NOW)).toHaveLength(1);
    expect(parseClaudeMemories('nope', NOW)).toEqual([]);
    expect(parseClaudeMemories([{ conversations_memory: '' }], NOW)).toEqual([]);
  });
});
