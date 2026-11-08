import { readStats } from '@/lib/stats';

export async function GET() {
  return Response.json(await readStats(), { headers: { 'cache-control': 'no-store' } });
}
