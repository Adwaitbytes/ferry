import type { GateRecallResult as CoreResult } from '@ferry/core';
import { describe, expectTypeOf, it } from 'vitest';
import type { GateRecallResult } from '../src/index.js';

describe('public types', () => {
  it('GateRecallResult matches the frozen core contract exactly', () => {
    expectTypeOf<GateRecallResult>().toEqualTypeOf<CoreResult>();
  });
});
