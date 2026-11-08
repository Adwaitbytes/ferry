'use client';

import { Button, cn, Textarea } from '@ferry/ui';
import { ArrowUpRight, ClipboardPaste, FileArchive } from 'lucide-react';
import { useId, useState, type DragEvent } from 'react';
import { MAX_FILE_BYTES, MAX_ZIP_BYTES, formatBytes, type SourceKind } from './pipeline';

export interface SourceSpec {
  kind: SourceKind;
  title: string;
  upload: string;
  howTo: string;
  accept: string;
  dropLabel: string;
}

export const SOURCES: readonly SourceSpec[] = [
  {
    kind: 'chatgpt',
    title: 'ChatGPT export',
    upload: 'The ZIP from Settings, Data controls, Export data. Ferry reads conversations.json inside it.',
    howTo: 'https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data',
    accept: '.zip,application/zip',
    dropLabel: 'Drop your ChatGPT export ZIP here, or choose a file',
  },
  {
    kind: 'claude',
    title: 'Claude export',
    upload: 'The ZIP from Settings, Privacy, Export data. Includes conversations, projects and memory.',
    howTo: 'https://support.anthropic.com/en/articles/9450526-how-can-i-export-my-claude-data',
    accept: '.zip,application/zip',
    dropLabel: 'Drop your Claude export ZIP here, or choose a file',
  },
  {
    kind: 'gemini',
    title: 'Gemini Takeout',
    upload: 'My Activity for Gemini Apps from Google Takeout, in JSON format. The Takeout ZIP works too.',
    howTo: 'https://takeout.google.com',
    accept: '.json,.zip,application/json,application/zip',
    dropLabel: 'Drop your Gemini Takeout JSON or ZIP here, or choose a file',
  },
  {
    kind: 'paste',
    title: 'Paste',
    upload: 'Ask any assistant what it knows about you, then paste the answer here.',
    howTo: '',
    accept: '',
    dropLabel: '',
  },
];

export function SourcePicker({ onPick }: { onPick: (spec: SourceSpec) => void }) {
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {SOURCES.map((spec) => (
        <li key={spec.kind} className="flex">
          <div className="relative flex flex-1 flex-col gap-2 rounded-md border border-border-hairline bg-surface-1 p-6 shadow-1 transition-[border-color,box-shadow] duration-150 ease-out hover:border-border-strong hover:shadow-2">
            <h2 className="text-title font-semibold text-text-primary">
              <button type="button" onClick={() => onPick(spec)} className="text-left after:absolute after:inset-0 after:content-['']">
                {spec.title}
              </button>
            </h2>
            <p className="text-body text-text-secondary">{spec.upload}</p>
            {spec.howTo ? (
              <a
                href={spec.howTo}
                target="_blank"
                rel="noreferrer noopener"
                className="relative z-10 mt-auto inline-flex items-center gap-1 self-start pt-2 text-small text-accent underline-offset-[3px] hover:underline"
              >
                How to get it
                <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
              </a>
            ) : (
              <span className="mt-auto inline-flex items-center gap-1.5 pt-2 text-small text-text-tertiary">
                <ClipboardPaste size={14} strokeWidth={1.75} aria-hidden="true" />
                Works with any assistant
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Dropzone({ spec, onFile, error }: { spec: SourceSpec; onFile: (file: File) => void; error: string | null }) {
  const id = useId();
  const [over, setOver] = useState(false);
  const [sizeError, setSizeError] = useState<string | null>(null);

  const accept = (file: File | undefined) => {
    if (!file) return;
    const limit = file.name.toLowerCase().endsWith('.zip') ? MAX_ZIP_BYTES : MAX_FILE_BYTES;
    if (file.size > limit) {
      setSizeError(`This file is ${formatBytes(file.size)}. Ferry reads up to ${formatBytes(limit)} per import. Split the export and import each part.`);
      return;
    }
    setSizeError(null);
    onFile(file);
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setOver(false);
    accept(event.dataTransfer.files[0]);
  };

  const message = sizeError ?? error;
  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={id}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex h-[200px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center transition-colors duration-150 ease-out',
          'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-ring',
          over ? 'border-accent bg-accent-subtle' : 'border-border-control bg-surface-1 hover:bg-surface-2',
        )}
      >
        <FileArchive size={24} strokeWidth={1.5} aria-hidden="true" className={over ? 'text-accent' : 'text-text-secondary'} />
        <span className="text-body font-medium text-text-primary">{over ? 'Release to read it on this device' : spec.dropLabel}</span>
        <span className="text-small text-text-tertiary">Parsing happens on this device. The raw export never leaves it.</span>
        <input
          id={id}
          type="file"
          accept={spec.accept}
          className="sr-only"
          onChange={(event) => {
            accept(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>
      {message ? (
        <p role="alert" className="text-small text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}

export function PasteBox({ onSubmit, error }: { onSubmit: (text: string) => void; error: string | null }) {
  const [text, setText] = useState('');
  return (
    <div className="flex flex-col gap-4">
      <Textarea
        label="What an assistant says it knows about you"
        placeholder="Ask: what do you know about me? Then paste the full answer here."
        value={text}
        maxLength={200_000}
        onChange={(event) => setText(event.target.value)}
        className="min-h-48"
        error={error}
      />
      <Button variant="primary" className="self-start" disabled={text.trim().length === 0} onClick={() => onSubmit(text)}>
        Find facts in this text
      </Button>
    </div>
  );
}
