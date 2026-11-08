import { z } from 'zod';
import { SuiObjectId } from '@ferry/core';
import { PriceSymbol, WALRUS_BLOB_ID } from '@ferry/chain';

/** Hex is case-insensitive on input; core's SuiObjectId is the lowercase canonical form. */
export const ObjectIdParam = z.string().max(66).transform((v) => v.toLowerCase()).pipe(SuiObjectId);

export const BlobParam = z.union([ObjectIdParam, z.string().regex(WALRUS_BLOB_ID)]);

export const SymbolParam = PriceSymbol;
