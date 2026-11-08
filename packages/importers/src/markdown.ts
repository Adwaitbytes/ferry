import { FACT_TYPES, type FactType, type StoredMemory, type Vendor } from '@ferry/core';

const TYPE_HEADINGS: Readonly<Record<FactType, string>> = {
  identity: 'Who I am',
  preference: 'Preferences',
  dislike: 'Dislikes',
  person: 'People',
  project: 'Projects',
  goal: 'Goals',
  routine: 'Routines',
  decision: 'Decisions',
  skill: 'Skills',
  constraint: 'Constraints',
  lesson: 'Lessons',
};

const VENDOR_NAMES: Readonly<Record<Vendor, string>> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  paste: 'Paste',
  desk: 'Ferry Desk',
  manual: 'Typed in Ferry',
};

/**
 * Memory text is untrusted. Escaping every Markdown control character keeps a fact from turning
 * into a heading, link, image or raw HTML when the file is rendered somewhere else.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\\`*_{}[\]()<>#+\-.!|~]/g, (c) => `\\${c}`);
}

export interface MarkdownOptions {
  now?: Date;
  title?: string;
}

/**
 * Human-readable export of current memories grouped by type. Superseded, hidden and quarantined
 * memories are left out; unresolved conflicts are kept and marked.
 */
export function toMarkdown(memories: readonly StoredMemory[], opts: MarkdownOptions = {}): string {
  const current = memories.filter((m) => (m.status === 'active' || m.status === 'conflict') && m.text.trim().length > 0);
  const date = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const lines = [`# ${escapeMarkdown(opts.title ?? 'My memory, exported from Ferry')}`, '', `Exported ${date}. ${current.length} memories.`];
  for (const type of FACT_TYPES) {
    const group = current
      .filter((m) => m.header.type === type)
      .sort((a, b) => b.header.at.localeCompare(a.header.at) || a.text.localeCompare(b.text));
    if (group.length === 0) continue;
    lines.push('', `## ${TYPE_HEADINGS[type]}`, '');
    for (const memory of group) {
      const heard = memory.header.sources.map((v) => VENDOR_NAMES[v]).join(', ');
      const conflict = memory.status === 'conflict' ? ' (unresolved conflict)' : '';
      lines.push(`- ${escapeMarkdown(memory.text)}${conflict} _(${heard}, ${memory.header.at})_`);
    }
  }
  return `${lines.join('\n')}\n`;
}
