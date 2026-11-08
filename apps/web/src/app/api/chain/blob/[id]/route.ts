import type { NextRequest } from 'next/server';
import { chainRoute, preflight } from '../../_lib/http';
import { BlobParam, ObjectIdParam } from '../../_lib/params';

export const runtime = 'nodejs';

/**
 * Walrus Blob receipt (F4) as a core BlobView. `id` is a Blob object id or a Walrus blob id; with a
 * bare blob id, pass `?objectId=` to get epochs and owner, since Sui cannot look a blob up by id.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return chainRoute(request, 'blob', async (chain) => {
    const id = BlobParam.parse((await context.params).id);
    const objectId = request.nextUrl.searchParams.get('objectId');
    return chain.readBlob(id, objectId === null ? {} : { objectId: ObjectIdParam.parse(objectId) });
  });
}

export const OPTIONS = preflight;
