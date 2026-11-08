/** Motion tokens (DESIGN 5.1). Durations are seconds because Motion takes seconds. */
export const duration = { fast: 0.15, base: 0.2, slow: 0.24, slower: 0.28 } as const;

export const ease = {
  out: [0.22, 1, 0.36, 1],
  in: [0.4, 0, 1, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export const spring = {
  card: { type: 'spring', stiffness: 420, damping: 34, mass: 1 },
  board: { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 },
  chip: { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 },
  drawer: { type: 'spring', stiffness: 380, damping: 40, mass: 1 },
} as const;

/** Reduced motion: position and scale jump; only opacity keeps a short fade (DESIGN 5.2). */
export const instant = { duration: 0 } as const;
