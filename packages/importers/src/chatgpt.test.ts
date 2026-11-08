import { describe, expect, it } from 'vitest';
import { CHATGPT_PROFILE_CONVERSATION_ID, chatGptProfileConversation, parseChatGptConversation } from './chatgpt.js';
import { fixtureJson } from './test-helpers.js';

const NOW = Date.UTC(2026, 10, 9);
const conversations = fixtureJson('chatgpt/conversations.json') as unknown[];
const parse = (i: number) => parseChatGptConversation(conversations[i], NOW);

function userMessage(id: string, parent: string | null, text: string, children: string[] = [], createTime: number | null = 1735725600) {
  return {
    id,
    parent,
    children,
    message: { id, author: { role: 'user' }, create_time: createTime, content: { content_type: 'text', parts: [text] } },
  };
}

describe('parseChatGptConversation: fixtures', () => {
  it('follows current_node for the canonical thread and appends abandoned branches', () => {
    const { conversation } = parse(0);
    expect(conversation?.turns.map((t) => t.text)).toEqual([
      'I want to plan a weekend trip to the mountains near Exampleville. I hate long drives, three hours max.',
      "Relaxing. I'm recovering from a knee injury so no hiking this time.",
      'Perfect. My partner Sam (also synthetic) is allergic to cats, so no pet-friendly cabins.',
      'Hiking, but nothing above 2000 metres because of my knee.',
    ]);
    expect(conversation?.url).toBe('https://chatgpt.com/c/6770a1b2-0000-4000-8000-000000000001');
    expect(conversation?.title).toBe('SYNTHETIC: Weekend trip planning');
  });

  it('keeps message times and attaches the nearest assistant reply as context', () => {
    const turns = parse(0).conversation?.turns ?? [];
    expect(turns[0]?.at).toBe(1735725660500);
    expect(turns[0]?.assistantContext).toBeUndefined();
    expect(turns[1]?.assistantContext).toContain('three mountain towns');
    expect(turns[2]?.assistantContext).toBe('Second regeneration: a lakeside cabin with a sauna.');
  });

  it('extracts custom instructions from user_editable_context without the boilerplate', () => {
    const { profileTexts, startedAt } = parse(0);
    expect(profileTexts).toEqual([
      'I am a synthetic test persona named Alex Example. I work as a product designer in the fictional town of Exampleville. I am vegetarian.',
      'Keep answers short and use metric units.',
    ]);
    expect(startedAt).toBe(1735725600123);
  });

  it('handles multiple roots, orphans, a dangling current_node and zero or null timestamps', () => {
    const { conversation } = parse(1);
    expect(conversation?.turns.map((t) => [t.text, t.at])).toEqual([
      ['I run every Tuesday and Thursday morning before work.', 1738400000000],
      ['My favourite programming language is Rust.', 1738400000000],
      ['I am building a synthetic budgeting app for students.', 1738400200000],
    ]);
    expect(conversation?.turns[2]?.assistantContext).toBeUndefined();
  });

  it('keeps only string parts and supported content types', () => {
    const turns = parse(2).conversation?.turns ?? [];
    expect(turns.map((t) => t.text)).toEqual([
      'This is a photo of my synthetic sourdough starter. I bake bread every Sunday.',
      "print('my synthetic hello world')",
    ]);
  });

  it('falls back to update_time, then to the import time', () => {
    expect(parse(3).conversation?.turns[0]?.at).toBe(1741000000000);
    const bare = parseChatGptConversation({ id: 'x', mapping: { n: userMessage('n', null, 'hello there', [], 0) } }, NOW);
    expect(bare.conversation?.turns[0]?.at).toBe(NOW);
  });

  it('returns null for elements that are not conversations', () => {
    expect(parse(4).conversation).toBeNull();
    expect(parse(5).conversation).toBeNull();
    expect(parseChatGptConversation({ mapping: {} }, NOW).conversation).toBeNull();
    expect(parseChatGptConversation({ id: 'x', mapping: [] }, NOW).conversation).toBeNull();
  });

  it('uses conversation_id when id is missing and skips unsafe ids for links', () => {
    const scriptId = ['javascript', 'alert(1)'].join(':');
    const { conversation } = parseChatGptConversation({ conversation_id: scriptId, mapping: { n: userMessage('n', null, 'hi there') } }, NOW);
    expect(conversation?.id).toBe(scriptId);
    expect(conversation?.url).toBeNull();
  });
});

describe('parseChatGptConversation: red team', () => {
  it('treats __proto__ and constructor mapping keys as plain node ids', () => {
    const first = JSON.stringify(userMessage('constructor', null, 'first message', ['__proto__']));
    const second = JSON.stringify(userMessage('__proto__', 'constructor', 'second message'));
    // JSON.parse defines "__proto__" as an own key, exactly as a hostile export would arrive.
    const raw = JSON.parse(`{"id":"proto","current_node":"__proto__","mapping":{"constructor":${first},"__proto__":${second}}}`) as unknown;
    const { conversation } = parseChatGptConversation(raw, NOW);
    expect(conversation?.turns.map((t) => t.text)).toEqual(['first message', 'second message']);
    expect(({} as Record<string, unknown>).id).toBeUndefined();
  });

  it('walks a 200,000 node chain iteratively without overflowing the stack', () => {
    const mapping: Record<string, unknown> = {};
    const depth = 200_000;
    for (let i = 0; i < depth; i += 1) {
      const id = `n${i}`;
      mapping[id] = i % 1000 === 0
        ? userMessage(id, i === 0 ? null : `n${i - 1}`, `message ${i}`, i + 1 < depth ? [`n${i + 1}`] : [])
        : { id, parent: i === 0 ? null : `n${i - 1}`, children: i + 1 < depth ? [`n${i + 1}`] : [], message: null };
    }
    const withCurrent = parseChatGptConversation({ id: 'deep', current_node: `n${depth - 1}`, mapping }, NOW);
    expect(withCurrent.conversation?.turns).toHaveLength(200);
    const withoutCurrent = parseChatGptConversation({ id: 'deep', mapping }, NOW);
    expect(withoutCurrent.conversation?.turns).toHaveLength(200);
  });

  it('terminates on parent cycles and child cycles', () => {
    const mapping = {
      a: userMessage('a', 'c', 'cycle a', ['b']),
      b: userMessage('b', 'a', 'cycle b', ['c']),
      c: userMessage('c', 'b', 'cycle c', ['a']),
      self: userMessage('self', 'self', 'self loop', ['self']),
    };
    const { conversation } = parseChatGptConversation({ id: 'cyc', current_node: 'a', mapping }, NOW);
    expect(conversation?.turns.map((t) => t.text).sort()).toEqual(['cycle a', 'cycle b', 'cycle c', 'self loop']);
    const noCurrent = parseChatGptConversation({ id: 'cyc', mapping }, NOW);
    expect(noCurrent.conversation?.turns).toHaveLength(4);
  });

  it('ignores malformed nodes, children and authors', () => {
    const { conversation } = parseChatGptConversation(
      {
        id: 'junk',
        mapping: {
          bad: 'not a node',
          n: { parent: null, children: [1, null, 'gone'], message: { author: 'nobody', content: { content_type: 'text', parts: ['x'] } } },
          u: { ...userMessage('u', 'n', 'kept'), children: 'nope' },
        },
      },
      NOW,
    );
    expect(conversation?.turns.map((t) => t.text)).toEqual(['kept']);
  });

  it('dedupes branch turns that repeat canonical text', () => {
    const mapping = {
      r: userMessage('r', null, 'Same thing', ['b1', 'b2']),
      b1: userMessage('b1', 'r', 'same   THING'),
      b2: userMessage('b2', 'r', 'Different thing'),
    };
    const { conversation } = parseChatGptConversation({ id: 'd', current_node: 'b2', mapping }, NOW);
    expect(conversation?.turns.map((t) => t.text)).toEqual(['Same thing', 'Different thing']);
  });

  it('keeps only the tail of very long assistant context', () => {
    const long = `${'x'.repeat(5000)}END`;
    const mapping = {
      a: { id: 'a', parent: null, children: ['u'], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: [long] } } },
      u: userMessage('u', 'a', 'reply'),
    };
    const { conversation } = parseChatGptConversation({ id: 'l', mapping }, NOW);
    const context = conversation?.turns[0]?.assistantContext ?? '';
    expect(context).toHaveLength(1000);
    expect(context.endsWith('END')).toBe(true);
  });
});

describe('chatGptProfileConversation', () => {
  it('dedupes texts into one synthetic conversation', () => {
    const profile = chatGptProfileConversation(['I like tea', 'i like  tea', 'I code'], 5);
    expect(profile?.id).toBe(CHATGPT_PROFILE_CONVERSATION_ID);
    expect(profile?.turns.map((t) => t.text)).toEqual(['I like tea', 'I code']);
    expect(profile?.url).toBeNull();
  });

  it('returns null when there is nothing', () => {
    expect(chatGptProfileConversation([], 0)).toBeNull();
  });
});
