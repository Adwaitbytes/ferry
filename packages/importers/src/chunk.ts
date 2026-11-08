import { MAX_CHUNK_CHARS, MAX_DISTILL_CHUNKS, hashShort } from '@ferry/core';
import type { ChunkSegment, ChunkSource, DistillChunk, NormalizedConversation } from './types.js';
import { splitText } from './text.js';
import { toIso } from './time.js';

const SEPARATOR = '\n\n';
/** Receipt.conversationId is capped at 200; longer ids can only come from a crafted file. */
const MAX_CONVERSATION_ID = 200;

export interface ChunkOutput {
  chunks: DistillChunk[];
  sources: ChunkSource[];
  userTurns: number;
  skippedConversations: number;
}

interface Piece {
  text: string;
  at: number;
  assistantContext?: string;
}

function piecesOf(conversation: NormalizedConversation): Piece[] {
  const pieces: Piece[] = [];
  for (const turn of conversation.turns) {
    splitText(turn.text, MAX_CHUNK_CHARS).forEach((text, i) => {
      const piece: Piece = { text, at: turn.at };
      if (i === 0 && turn.assistantContext) piece.assistantContext = turn.assistantContext;
      pieces.push(piece);
    });
  }
  return pieces;
}

/**
 * Groups consecutive user turns of one conversation into chunks of at most MAX_CHUNK_CHARS.
 * Chunk ids are deterministic (vendor, conversation hash, index) so a resumed import produces the
 * same ids and the queue can skip work it already did.
 */
export async function chunkConversation(
  conversation: NormalizedConversation,
): Promise<{ chunks: DistillChunk[]; sources: ChunkSource[] } | null> {
  if (conversation.id.length === 0 || conversation.id.length > MAX_CONVERSATION_ID) return null;
  const pieces = piecesOf(conversation);
  if (pieces.length === 0) return { chunks: [], sources: [] };
  const conversationIdHash = await hashShort(conversation.id);
  const chunks: DistillChunk[] = [];
  const sources: ChunkSource[] = [];

  let group: Piece[] = [];
  let length = 0;
  const flush = (): void => {
    const first = group[0];
    if (!first) return;
    const chunkId = `${conversation.vendor}_${conversationIdHash}_${chunks.length}`;
    const segments: ChunkSegment[] = [];
    let offset = 0;
    for (const piece of group) {
      segments.push({ start: offset, end: offset + piece.text.length, messageAt: toIso(piece.at) });
      offset += piece.text.length + SEPARATOR.length;
    }
    const userText = group.map((p) => p.text).join(SEPARATOR);
    const messageAt = toIso(first.at);
    const chunk: DistillChunk = { chunkId, vendor: conversation.vendor, conversationIdHash, messageAt, userText };
    if (first.assistantContext) chunk.assistantContext = first.assistantContext;
    chunks.push(chunk);
    sources.push({
      chunkId,
      vendor: conversation.vendor,
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      conversationUrl: conversation.url,
      messageAt,
      rawUserText: userText,
      segments,
    });
    group = [];
    length = 0;
  };

  for (const piece of pieces) {
    const added = (group.length > 0 ? SEPARATOR.length : 0) + piece.text.length;
    if (length + added > MAX_CHUNK_CHARS) flush();
    length += (group.length > 0 ? SEPARATOR.length : 0) + piece.text.length;
    group.push(piece);
  }
  flush();
  return { chunks, sources };
}

/** Splits chunks into Distill-sized batches (MAX_DISTILL_CHUNKS per request). */
export function batchChunks<T>(chunks: readonly T[], size: number = MAX_DISTILL_CHUNKS): T[][] {
  if (!Number.isInteger(size) || size < 1 || size > MAX_DISTILL_CHUNKS) {
    throw new RangeError(`batchChunks: size must be an integer in 1..${MAX_DISTILL_CHUNKS}`);
  }
  const batches: T[][] = [];
  for (let i = 0; i < chunks.length; i += size) batches.push(chunks.slice(i, i + size));
  return batches;
}

/**
 * Message time for a quote inside a chunk: the segment that contains it, else the chunk start.
 * Lets a receipt show when the user actually said it, not when the chunk began.
 */
export function locateQuote(source: ChunkSource, quote: string): string {
  const index = quote ? source.rawUserText.indexOf(quote) : -1;
  if (index === -1) return source.messageAt;
  const segment = source.segments.find((s) => index >= s.start && index < s.end);
  return segment?.messageAt ?? source.messageAt;
}

export function indexSources(sources: readonly ChunkSource[]): Map<string, ChunkSource> {
  return new Map(sources.map((s) => [s.chunkId, s]));
}
