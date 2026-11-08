import type { Metadata } from 'next';
import { StartView } from './start-view';

export const metadata: Metadata = { title: 'Get started' };

export default function StartPage() {
  return <StartView />;
}
