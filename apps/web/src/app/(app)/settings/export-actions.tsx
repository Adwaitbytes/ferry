'use client';

import { toMarkdown, toPam } from '@ferry/importers';
import { Button, useToast } from '@ferry/ui';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { bridge } from '@/lib/bridge';

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Export everything through the extension (F11). Runs on this device; nothing is uploaded. */
export function ExportActions() {
  const toast = useToast();
  const [busy, setBusy] = useState<'json' | 'md' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: 'json' | 'md') => {
    setBusy(kind);
    setError(null);
    try {
      const memories = await bridge({ type: 'data.export' }, { timeoutMs: 60_000 });
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === 'json') download(`ferry-memory-${stamp}.json`, 'application/json', JSON.stringify(await toPam(memories), null, 2));
      else download(`ferry-memory-${stamp}.md`, 'text/markdown', toMarkdown(memories));
      toast.show({ message: `Exported ${memories.length.toLocaleString('en-US')} facts.` });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Button icon={Download} loading={busy === 'json'} loadingLabel="Exporting" disabled={busy !== null} onClick={() => void run('json')}>
          Export JSON (PAM compatible)
        </Button>
        <Button icon={Download} loading={busy === 'md'} loadingLabel="Exporting" disabled={busy !== null} onClick={() => void run('md')}>
          Export Markdown
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
