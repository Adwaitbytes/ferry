import { normalizeUncapped } from './unicode.js';

/** Analysis window. Durable statements sit near the start of a message far more often than deep in a paste. */
const MAX_ANALYSED_CHARS = 4000;

const DURABLE: readonly RegExp[] = [
  /\b(?:i am|i'm|im) (?:a|an) [a-z]/,
  /\b(?:i am|i'm|im) (?:vegetarian|vegan|pescatarian|left-handed|colou?rblind|allergic|lactose intolerant|gluten intolerant|diabetic|\d{1,3} years old|based in|from|originally from|married|single|divorced|retired|a parent)\b/,
  /\bmy name is\b|\bcall me\b/,
  /\bi (?:live|grew up|was born) in\b/,
  /\bi (?:really |strongly |generally |usually |much )?(?:prefer|like|love|enjoy|hate|dislike|detest|avoid|can't stand|cannot stand)\b/,
  /\bi'?d rather\b|\bmy favou?rite\b/,
  /\bi (?:don't|do not|never|can't|cannot) (?:eat|drink|use|work|travel|fly|drive|watch|read)\b/,
  /\bmy (?:budget|deadline|timezone|time zone) is\b/,
  /\bmy (?:wife|husband|partner|boyfriend|girlfriend|son|daughter|kids?|children|mom|mother|dad|father|brother|sister|boss|manager|cofounder|co-founder|best friend|dog|cat)(?:'s name)? (?:is|are|was|works|lives)\b/,
  /\bi (?:work|am working|'m working) (?:at|for|on|as|in)\b|\bi'?m working (?:at|for|on|as|in)\b/,
  /\b(?:i am|i'm) (?:building|developing|learning|studying|training for|preparing for|saving for)\b/,
  /\bmy (?:job|role|company|startup|team|project|thesis|business) (?:is|focuses|builds|makes)\b/,
  /\bmy goal is\b|\bi plan to\b|\bi'?m planning to\b/,
  /\bi (?:usually|always|never|often|typically|normally)\b/,
  /\bevery (?:morning|day|evening|night|week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  /\b(?:i've|i have|i) decided\b|\bfrom now on,? i\b/,
  /\bi (?:switched|moved|started|stopped|quit)\b/,
  /\bi (?:speak|code in|program in|know how to)\b|\bi'?m (?:fluent|proficient) in\b/,
  /\bi (?:learned|realized|found out) that\b|\blesson learned\b/,
];

const HYPOTHETICAL = /\b(?:if i were|imagine|pretend|suppose|what if|hypothetically|let's say|in this story|role ?play|my character)\b/;
const QUESTION_START = /^(?:what|how|why|can|could|would|should|is|are|do|does|did|where|when|who|which)\b/;

/**
 * Cheap on-device pre-filter run on every sent message before the light LLM call (PRD F3).
 * It favours recall: false positives only cost an LLM call, which can return no facts.
 */
export function isLikelyDurableFact(userText: string): boolean {
  const text = normalizeUncapped(userText.slice(0, MAX_ANALYSED_CHARS)).toLowerCase().replace(/[\u2018\u2019]/g, "'");
  if (text.length < 6) return false;
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .some((sentence) => {
      if (HYPOTHETICAL.test(sentence)) return false;
      if (sentence.endsWith('?') && QUESTION_START.test(sentence)) return false;
      return DURABLE.some((re) => re.test(sentence));
    });
}
