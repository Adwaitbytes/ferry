import { describe, expect, it } from 'vitest';
import { isLikelyDurableFact } from './capture.js';

describe('isLikelyDurableFact', () => {
  it.each([
    "I'm vegetarian and allergic to cashews",
    'Can you plan dinner? I\u2019m vegan.',
    'I am a backend engineer at a fintech.',
    'My name is Priya.',
    'I live in Pune.',
    'I prefer answers in bullet points.',
    "I'd rather fly in the morning.",
    "I don't eat pork.",
    'My budget is 2000 euros.',
    "My wife's name is Ana.",
    'I work at Stripe on payments.',
    "I'm building a memory app on Walrus.",
    'My goal is to run a marathon.',
    'I usually wake up at 6.',
    'Every Sunday I call my parents.',
    "I've decided to stop using Jira.",
    'I switched to Neovim last year.',
    "I'm fluent in Spanish.",
    'I learned that small PRs ship faster.',
  ])('accepts %s', (text) => {
    expect(isLikelyDurableFact(text)).toBe(true);
  });

  it.each([
    'hi',
    'Write me a cover letter for this job.',
    'What is the capital of France?',
    'Do I prefer tea or coffee?',
    'Imagine I live in Paris, what would I eat?',
    'If I were a pilot I would fly every day.',
    'Fix this bug in my code please.',
    'Translate this paragraph into German.',
  ])('rejects %s', (text) => {
    expect(isLikelyDurableFact(text)).toBe(false);
  });
});
