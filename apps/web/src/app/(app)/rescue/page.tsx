import type { Metadata } from 'next';
import { RescueView } from './rescue-view';

export const metadata: Metadata = { title: 'Rescue' };

export default function RescuePage() {
  return <RescueView />;
}
