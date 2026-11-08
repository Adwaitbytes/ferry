import type { Metadata } from 'next';
import { LibraryView } from './library-view';

export const metadata: Metadata = { title: 'Library' };

export default function LibraryPage() {
  return <LibraryView />;
}
