import { describe, expect, it } from 'vitest';
import { importZip } from './import.js';
import { zipOf } from './test-helpers.js';

const TARGET_BYTES = 50 * 1024 * 1024;

/** Synthetic ChatGPT export of about 50 MB: realistic node shapes, branches and filler prose. */
function buildExport(): string {
  const conversations: string[] = [];
  let size = 0;
  let c = 0;
  const filler = 'This is synthetic filler text about an imaginary project, written only for load testing. ';
  while (size < TARGET_BYTES) {
    const mapping: Record<string, unknown> = { root: { id: 'root', message: null, parent: null, children: ['m0'] } };
    const turns = 20;
    for (let t = 0; t < turns; t += 1) {
      const id = `m${t}`;
      mapping[id] = {
        id,
        parent: t === 0 ? 'root' : `m${t - 1}`,
        children: t + 1 < turns ? [`m${t + 1}`] : [],
        message: {
          id,
          author: { role: t % 2 === 0 ? 'user' : 'assistant', name: null, metadata: {} },
          create_time: 1735725600 + c * 60 + t,
          content: { content_type: 'text', parts: [`Turn ${t} of conversation ${c}. ${filler.repeat(t % 2 === 0 ? 2 : 5)}`] },
          status: 'finished_successfully',
          metadata: {},
        },
      };
    }
    const json = JSON.stringify({
      title: `Synthetic load conversation ${c}`,
      create_time: 1735725600 + c * 60,
      update_time: 1735725600 + c * 60 + 30,
      mapping,
      current_node: `m${turns - 1}`,
      id: `00000000-0000-4000-8000-${c.toString().padStart(12, '0')}`,
    });
    conversations.push(json);
    size += json.length + 1;
    c += 1;
  }
  return `[${conversations.join(',')}]`;
}

describe.skipIf(process.env.FERRY_SKIP_BIG === '1')('50 MB export', () => {
  it('parses within time and memory budgets', { timeout: 120_000 }, async () => {
    const text = buildExport();
    expect(text.length).toBeGreaterThanOrEqual(TARGET_BYTES);
    const bytes = zipOf({ 'conversations.json': text, 'user.json': '{}' });
    const heapBefore = process.memoryUsage().heapUsed;
    let peakHeap = heapBefore;
    let longestGap = 0;
    let last = performance.now();
    const monitor = setInterval(() => {
      const t = performance.now();
      longestGap = Math.max(longestGap, t - last);
      last = t;
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    }, 5);

    const started = performance.now();
    const result = await importZip(bytes);
    const elapsed = performance.now() - started;
    clearInterval(monitor);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stats.conversations).toBeGreaterThan(1000);
    expect(result.value.chunks.length).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(60_000);
    expect(peakHeap - heapBefore).toBeLessThan(1024 * 1024 * 1024);
    console.info(
      `50MB import: ${Math.round(elapsed)}ms, ${result.value.stats.conversations} conversations, ${result.value.chunks.length} chunks, ` +
        `peak heap +${Math.round((peakHeap - heapBefore) / 1048576)}MB, longest event-loop gap ${Math.round(longestGap)}ms (includes JSON.parse)`,
    );
  });
});
