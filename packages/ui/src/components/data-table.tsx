import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../cn';

/** Real table semantics inside a rounded container that scrolls horizontally on its own (DESIGN 7.16). */
export function DataTable({ caption, children, className }: { caption: string; children: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn('overflow-x-auto rounded-md border border-border-hairline bg-surface-1', className)}>
      <table className="w-full border-collapse text-left text-body">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function DataHead({ columns }: { columns: readonly { label: string; align?: 'left' | 'right'; srOnly?: boolean | undefined }[] }) {
  return (
    <thead className="sticky top-0 bg-surface-1">
      <tr className="border-b border-border-strong">
        {columns.map((column) => (
          <th
            key={column.label}
            scope="col"
            className={cn(
              'h-10 whitespace-nowrap px-3 text-small font-medium text-text-secondary first:pl-4 last:pr-4',
              column.align === 'right' && 'text-right',
            )}
          >
            {column.srOnly ? <span className="sr-only">{column.label}</span> : column.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export interface DataRowProps extends ComponentProps<'tr'> {
  selected?: boolean | undefined;
  tone?: 'default' | 'warning' | undefined;
}

export function DataRow({ selected, tone = 'default', className, ...rest }: DataRowProps) {
  return (
    <tr
      className={cn(
        'h-11 border-b border-border-hairline last:border-b-0',
        selected && 'bg-accent-subtle',
        tone === 'warning' && 'bg-warning-subtle/40',
        className,
      )}
      {...rest}
    />
  );
}

export function DataCell({ align, className, ...rest }: ComponentProps<'td'> & { align?: 'left' | 'right' }) {
  return <td className={cn('px-3 py-2 align-middle first:pl-4 last:pr-4', align === 'right' && 'text-right tabular', className)} {...rest} />;
}
