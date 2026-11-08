import type { Metadata } from 'next';
import { ShareView } from './share-view';

export const metadata: Metadata = { title: 'Share and Earn' };

export default function SharePage() {
  return <ShareView />;
}
