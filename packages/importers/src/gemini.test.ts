import { describe, expect, it } from 'vitest';
import { parseGeminiHtml, parseGeminiJson } from './gemini.js';
import { fixture, fixtureJson } from './test-helpers.js';

describe('parseGeminiJson', () => {
  const conversations = parseGeminiJson(fixtureJson('gemini/MyActivity.json')) ?? [];

  it('groups details and userInteractions entries by conversation id from titleUrl', () => {
    const bees = conversations.find((c) => c.id === 'abc123def456');
    expect(bees?.url).toBe('https://gemini.google.com/app/abc123def456');
    expect(bees?.turns.map((t) => t.text)).toEqual([
      'I am a synthetic persona who keeps bees as a hobby.',
      'How many hives should a beginner start with? I have a small garden.',
    ]);
    expect(bees?.turns[1]?.assistantContext).toBe('Beekeeping is a rewarding hobby.');
    expect(bees?.title).toBe('I am a synthetic persona who keeps bees as a hobby.');
  });

  it('reads "Prompted" titles, skips non-prompt activity, and splits sessions on time gaps', () => {
    const sessions = conversations.filter((c) => c.id.startsWith('gemini-session-'));
    expect(sessions.map((s) => s.turns.map((t) => t.text))).toEqual([
      ['plain text request that is not JSON'],
      [
        'What is a good stretching routine for a desk worker? I sit about ten hours a day.',
        'I prefer routines under 10 minutes, I have a bad lower back.',
      ],
      ["Translate 'good morning' into Portuguese, I'm learning it for a trip to a fictional city."],
    ]);
    const stretch = sessions[1];
    expect(stretch?.turns[1]?.assistantContext).toBe('Try these five stretches & take breaks every hour.');
    expect(stretch?.url).toBeNull();
    expect(stretch?.turns[0]?.at).toBe(Date.parse('2025-06-07T14:52:31.927Z'));
  });

  it('rejects non-array input', () => {
    expect(parseGeminiJson({ items: [] })).toBeNull();
  });

  it('learns a localized prompt prefix when no known prefix is present', () => {
    const entries = ['Pergunta: eu moro numa cidade ficticia', 'Pergunta: gosto de cafe', 'Outra coisa'].map((title, i) => ({
      title,
      time: `2025-01-0${i + 1}T10:00:00Z`,
    }));
    const texts = (parseGeminiJson(entries) ?? []).flatMap((c) => c.turns.map((t) => t.text));
    expect(texts).toEqual(['eu moro numa cidade ficticia', 'gosto de cafe']);
  });

  it('does not learn a prefix from a minority of titles', () => {
    const entries = ['Note: one', 'Other two', 'Other three'].map((title) => ({ title, time: '2025-01-01T10:00:00Z' }));
    expect(parseGeminiJson(entries)).toEqual([]);
  });

  it('takes the first string from nested request JSON and survives junk interactions', () => {
    const entries = [
      {
        time: '2025-01-01T10:00:00Z',
        userInteractions: ['junk', { userInteraction: { request: '' } }, { userInteraction: { request: '[null, {"a": ["", "nested prompt"]}]' } }],
      },
      { time: '2025-01-01T10:01:00Z', details: ['junk', { name: 'Request', value: '' }], title: 'Prompted from title' },
      { time: '2025-01-01T10:02:00Z', userInteractions: 'nope', safeHtmlItem: 'nope', title: 'Prompted third' },
    ];
    const [session] = parseGeminiJson(entries) ?? [];
    expect(session?.turns.map((t) => t.text)).toEqual(['nested prompt', 'from title', 'third']);
  });
});

describe('parseGeminiHtml', () => {
  const conversations = parseGeminiHtml(fixture('gemini/MyActivity.html'));
  const turns = conversations.flatMap((c) => c.turns);

  it('extracts prompts with entities decoded and multi-line prompts intact', () => {
    expect(turns.map((t) => t.text)).toEqual([
      "What should I cook tonight? I'm vegetarian & I hate mushrooms.",
      'Plan a dinner for four\nwith a second line in the prompt',
      'I\u2019m training for a 10k run in October.',
    ]);
  });

  it('parses US and international timestamps with zones', () => {
    expect(turns[0]?.at).toBe(Date.UTC(2025, 5, 7, 14, 52, 31));
    expect(turns[1]?.at).toBe(Date.UTC(2025, 5, 7, 22, 5, 0));
    expect(turns[2]?.at).toBe(Date.UTC(2025, 5, 9, 5, 30, 0));
  });

  it('never carries script content into context', () => {
    expect(turns[1]?.assistantContext).toBeUndefined();
    expect(JSON.stringify(conversations)).not.toContain('document.title');
  });

  it('returns nothing for HTML without activity cells', () => {
    expect(parseGeminiHtml('<html><body>empty</body></html>')).toEqual([]);
  });
});
