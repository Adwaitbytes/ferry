import { describe, expect, it } from 'vitest';
import { detectSensitive, ibanValid, luhnValid, verhoeffValid } from './sensitive.js';
import { screenCandidate } from './screen.js';

describe('checksums', () => {
  it('luhn, verhoeff and iban', () => {
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4111111111111112')).toBe(false);
    expect(verhoeffValid('497318520163')).toBe(true);
    expect(verhoeffValid('497318520164')).toBe(false);
    expect(ibanValid('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(ibanValid('GB82 WEST 1234 5698 7654 33')).toBe(false);
    expect(ibanValid('not an iban')).toBe(false);
  });
});

describe('detectSensitive', () => {
  it.each([
    ['card_number', 'card 5555.5555.5555.4444'],
    ['card_number', 'Devanagari digits \u096A\u0967\u0967\u0967 \u0967\u0967\u0967\u0967 \u0967\u0967\u0967\u0967 \u0967\u0967\u0967\u0967'],
    ['government_id', 'my social security number is 536 90 4399'],
    ['government_id', 'My passport number is K1234567'],
    ['government_id', 'NI number AB 12 34 56 C'],
    ['password', 'my password: correct-horse'],
    ['password', 'pw = s3cret!'],
    ['secret_key', '-----BEGIN OPENSSH PRIVATE KEY----- abc'],
    ['secret_key', 'jwt ' + 'eyJ' + 'hbGciOiJIUzI1' + '.eyJ' + 'zdWIiOiIxMjM0' + '.' + 'SflKxwRJSMeKKF2QT4'],
    ['secret_key', 'slack ' + 'xo' + 'xb-' + '1234567890-abcdef'],
    ['secret_key', 'stripe ' + 'sk' + '_live_' + 'abcdefghijklmnop1234'],
    ['secret_key', 'blob ' + 'Kq8' + 'zR2vT9mXw4LpN7bYc3HdF6gJ1sA5eU0i'],
    ['secret_key', 'wallet seed ' + 'abandon '.repeat(11) + 'about zoo'],
    ['finance', 'my account number is 0123 4567 89'],
    ['finance', 'I earn $120k before tax'],
    ['finance', 'about 90k EUR per year from consulting'],
    ['finance', 'My credit score is 780'],
    ['finance', 'IFSC HDFC0001234'],
    ['health', 'I take 50 mg of sertraline'],
    ['precise_location', 'I live at 221B Baker Street'],
    ['precise_location', 'home is 18.5204, 73.8567'],
    ['precise_location', 'flat 4B on the third floor'],
    ['sexuality', "I'm gay and out at work"],
    ['religion', 'I am Hindu'],
    ['religion', 'I fast during Ramadan'],
    ['politics', 'I voted for the Green party'],
    ['politics', "I'm a libertarian"],
  ])('finds %s in %s', (category, text) => {
    expect(detectSensitive(text).categories).toContain(category);
  });

  it.each([
    'I am vegetarian and allergic to cashews.',
    'I use a password manager for everything.',
    'I really like ' + 'very '.repeat(60) + 'long walks',
    'My bus pass is valid until June.',
    'Please pin this tab: dashboard',
    'My password is strong.',
    'I run 5k every Sunday at 7am.',
    'Call me on Mondays, I work at Stripe.',
    'I moved to Pune in August and I work on payments infra.',
    'Order 4111 1111 1111 1112 arrived',
    'The meeting is at 10:30 in room 4.',
    'I have a 3f786850e387550fdab836ed7e6dc881de23001b commit hash',
    'I like the able about above absent absorb abstract absurd abuse access accident account accuse words',
  ])('finds nothing in %s', (text) => {
    expect(detectSensitive(text)).toEqual({ categories: [], blocked: false });
  });

  it('marks only ALWAYS_BLOCKED categories as blocked', () => {
    expect(detectSensitive('I was diagnosed with asthma').blocked).toBe(false);
    expect(detectSensitive('my SSN is 536-90-4399').blocked).toBe(true);
  });

  it('does not report an IBAN as a card', () => {
    expect(detectSensitive('My IBAN is GB82 WEST 1234 5698 7654 32').categories).toEqual(['finance']);
  });
});

describe('screenCandidate', () => {
  it('accepts an ordinary fact', () => {
    expect(screenCandidate('  Allergic to   cashews. ')).toEqual({ text: 'Allergic to cashews.', verdict: 'accept', reasons: [], flags: [], sensitive: [] });
  });

  it('blocks empty text and unions extra sensitive categories and LLM suspicion', () => {
    expect(screenCandidate('\u200B ').reasons).toEqual(['EMPTY', 'HIDDEN_ZERO_WIDTH']);
    expect(screenCandidate('\u200B ').verdict).toBe('blocked');
    const r = screenCandidate('Prefers tea.', { extraSensitive: ['religion'], llmInjectionSuspect: true });
    expect(r).toMatchObject({ verdict: 'quarantine', sensitive: ['religion'], flags: ['llm_classifier'], reasons: ['LLM_CLASSIFIER', 'SENSITIVE_RELIGION'] });
    expect(screenCandidate('Prefers tea.', { extraSensitive: ['password'] }).verdict).toBe('blocked');
  });

  it('respects a custom max length', () => {
    expect(screenCandidate('abcdef', { maxChars: 5 }).verdict).toBe('blocked');
  });
});
