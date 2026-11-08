import type { NormalizedConversation, UserTurn } from './types.js';
import { cleanText, dedupeKey, field, isRecord, str, tail } from './text.js';
import { epochSecondsToMs } from './time.js';
import { conversationUrl } from './urls.js';

/** Id of the synthetic conversation that carries the user's ChatGPT custom instructions. */
export const CHATGPT_PROFILE_CONVERSATION_ID = 'chatgpt-custom-instructions';

/** How far up the parent chain we look for the assistant message a user turn answers. */
const MAX_CONTEXT_HOPS = 8;

interface DagNode {
  id: string;
  parent: string | null;
  children: string[];
  message: Record<string, unknown> | null;
}

interface ChatGptParse {
  conversation: NormalizedConversation | null;
  /** User profile and instruction texts found in `user_editable_context` messages. */
  profileTexts: string[];
  /** Conversation start, used to date the custom instructions it carried. */
  startedAt: number;
}

function readNodes(mapping: Record<string, unknown>): Map<string, DagNode> {
  // Object.entries returns own keys only, and node ids live in a Map, so "__proto__" is just a string.
  const nodes = new Map<string, DagNode>();
  for (const [key, raw] of Object.entries(mapping)) {
    if (!isRecord(raw)) continue;
    const children = field(raw, 'children');
    const message = field(raw, 'message');
    nodes.set(key, {
      id: key,
      parent: str(raw, 'parent') ?? null,
      children: Array.isArray(children) ? children.filter((c): c is string => typeof c === 'string') : [],
      message: isRecord(message) ? message : null,
    });
  }
  return nodes;
}

/** Path from a root to `leaf`, following parent links. Stops on cycles and missing parents. */
function pathToRoot(nodes: Map<string, DagNode>, leaf: string): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = leaf;
  while (cursor !== null && nodes.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    path.push(cursor);
    cursor = nodes.get(cursor)?.parent ?? null;
  }
  return path.reverse();
}

/**
 * Every node in depth-first order, starting from roots (no parent, or a parent missing from the
 * mapping, which is how orphans appear), then from anything still unvisited (members of a cycle).
 * Iterative with a visited set: deep chains cannot overflow the stack and cycles cannot hang.
 */
function walkAll(nodes: Map<string, DagNode>): string[] {
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (start: string): void => {
    const stack = [start];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (visited.has(id)) continue;
      const node = nodes.get(id);
      if (!node) continue;
      visited.add(id);
      order.push(id);
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        const child = node.children[i] as string;
        if (!visited.has(child)) stack.push(child);
      }
    }
  };
  for (const node of nodes.values()) {
    if (node.parent === null || !nodes.has(node.parent)) visit(node.id);
  }
  for (const id of nodes.keys()) visit(id);
  return order;
}

/** Fallback branch when `current_node` is absent: follow the last child, which is the latest regeneration. */
function lastChildPath(nodes: Map<string, DagNode>, order: string[]): string[] {
  const root = order[0];
  if (root === undefined) return [];
  const path: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = root;
  while (cursor !== undefined && !seen.has(cursor)) {
    const node = nodes.get(cursor);
    if (!node) break;
    seen.add(cursor);
    path.push(cursor);
    cursor = node.children.filter((c) => nodes.has(c)).at(-1);
  }
  return path;
}

function role(message: Record<string, unknown>): string | undefined {
  const author = field(message, 'author');
  return isRecord(author) ? str(author, 'role') : undefined;
}

function stringParts(content: Record<string, unknown>): string {
  const parts = field(content, 'parts');
  if (!Array.isArray(parts)) return '';
  // Parts can hold null or objects (image and file pointers); only strings are user prose.
  return parts.filter((p): p is string => typeof p === 'string').join('\n');
}

/** Visible text of a message, by content type. Returns '' for types that carry no prose. */
function messageText(message: Record<string, unknown>): string {
  const content = field(message, 'content');
  if (!isRecord(content)) return '';
  switch (str(content, 'content_type')) {
    case 'text':
    case 'multimodal_text':
      return cleanText(stringParts(content));
    case 'code':
      return cleanText(str(content, 'text') ?? '');
    default:
      return '';
  }
}

/**
 * Custom instructions arrive wrapped in boilerplate with the user's words inside a fenced block.
 * We keep only the fenced text; without a fence, we keep the whole value.
 */
function unwrapProfile(value: string): string {
  const open = value.indexOf('```');
  const close = value.lastIndexOf('```');
  const inner = open !== -1 && close > open ? value.slice(open + 3, close) : value;
  return cleanText(inner);
}

function profileTexts(message: Record<string, unknown>): string[] {
  const content = field(message, 'content');
  if (!isRecord(content) || str(content, 'content_type') !== 'user_editable_context') return [];
  return ['user_profile', 'user_instructions']
    .map((key) => unwrapProfile(str(content, key) ?? ''))
    .filter((text) => text.length > 0);
}

function isHidden(message: Record<string, unknown>): boolean {
  const metadata = field(message, 'metadata');
  return isRecord(metadata) && field(metadata, 'is_visually_hidden_from_conversation') === true;
}

function precedingAssistantText(nodes: Map<string, DagNode>, id: string): string | undefined {
  let cursor = nodes.get(id)?.parent ?? null;
  for (let hop = 0; hop < MAX_CONTEXT_HOPS && cursor !== null; hop += 1) {
    const node = nodes.get(cursor);
    if (!node) return undefined;
    if (node.message) {
      const r = role(node.message);
      if (r === 'user') return undefined;
      if (r === 'assistant') {
        const text = messageText(node.message);
        if (text) return tail(text);
      }
    }
    cursor = node.parent;
  }
  return undefined;
}

/** Parses one element of ChatGPT `conversations.json`. Returns null conversation for unusable input. */
export function parseChatGptConversation(raw: unknown, fallbackMs: number): ChatGptParse {
  if (!isRecord(raw)) return { conversation: null, profileTexts: [], startedAt: fallbackMs };
  const mapping = field(raw, 'mapping');
  const id = str(raw, 'id') ?? str(raw, 'conversation_id');
  if (!isRecord(mapping) || id === undefined) return { conversation: null, profileTexts: [], startedAt: fallbackMs };

  const nodes = readNodes(mapping);
  const conversationMs = epochSecondsToMs(field(raw, 'create_time')) ?? epochSecondsToMs(field(raw, 'update_time')) ?? fallbackMs;
  const order = walkAll(nodes);
  const currentNode = str(raw, 'current_node');
  const canonical = currentNode !== undefined && nodes.has(currentNode) ? pathToRoot(nodes, currentNode) : lastChildPath(nodes, order);
  const canonicalSet = new Set(canonical);

  const seenText = new Set<string>();
  const profiles: string[] = [];
  const turnFor = (nodeId: string): UserTurn | null => {
    const message = nodes.get(nodeId)?.message;
    if (!message || role(message) !== 'user') return null;
    const profile = profileTexts(message);
    if (profile.length > 0) {
      profiles.push(...profile);
      return null;
    }
    if (isHidden(message)) return null;
    const text = messageText(message);
    if (!text) return null;
    const key = dedupeKey(text);
    if (seenText.has(key)) return null;
    seenText.add(key);
    const turn: UserTurn = { text, at: epochSecondsToMs(field(message, 'create_time')) ?? conversationMs };
    const context = precedingAssistantText(nodes, nodeId);
    if (context) turn.assistantContext = context;
    return turn;
  };

  const turns: UserTurn[] = [];
  for (const nodeId of canonical) {
    const turn = turnFor(nodeId);
    if (turn) turns.push(turn);
  }
  // Abandoned branches still hold things the user said; keep them after the canonical thread.
  const branchTurns: UserTurn[] = [];
  for (const nodeId of order) {
    if (canonicalSet.has(nodeId)) continue;
    const turn = turnFor(nodeId);
    if (turn) branchTurns.push(turn);
  }
  branchTurns.sort((a, b) => a.at - b.at);
  turns.push(...branchTurns);

  const title = str(raw, 'title');
  return {
    conversation: {
      vendor: 'chatgpt',
      id,
      title: title ? cleanText(title) : null,
      url: conversationUrl('chatgpt', id),
      turns,
    },
    profileTexts: profiles,
    startedAt: conversationMs,
  };
}

/** Collects custom instructions seen across conversations into one synthetic conversation. */
export function chatGptProfileConversation(texts: Iterable<string>, atMs: number): NormalizedConversation | null {
  const seen = new Set<string>();
  const turns: UserTurn[] = [];
  for (const text of texts) {
    const key = dedupeKey(text);
    if (seen.has(key)) continue;
    seen.add(key);
    turns.push({ text, at: atMs });
  }
  if (turns.length === 0) return null;
  return { vendor: 'chatgpt', id: CHATGPT_PROFILE_CONVERSATION_ID, title: 'ChatGPT custom instructions', url: null, turns };
}
