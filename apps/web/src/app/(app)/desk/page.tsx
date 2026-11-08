import type { Metadata } from 'next';
import { DeskView } from './desk-view';

export const metadata: Metadata = { title: 'Desk' };

export default function DeskPage() {
  return <DeskView />;
}
