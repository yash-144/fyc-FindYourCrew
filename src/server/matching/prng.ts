/**
 * Deterministic randomness.
 *
 * The module must never call `Math.random()`, `Date.now()` (except for the
 * duration measurement in the audit) or any other ambient source of entropy.
 * Everything stochastic flows from `MatchingInput.seed`.
 */

/** xmur3 string hash. Produces a stateful 32-bit generator used for seeding. */
function xmur3(input: string): () => number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function next(): number {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** sfc32: small, fast, well-distributed counter-based PRNG. */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  let s0 = a >>> 0;
  let s1 = b >>> 0;
  let s2 = c >>> 0;
  let s3 = d >>> 0;
  return function next(): number {
    s0 >>>= 0;
    s1 >>>= 0;
    s2 >>>= 0;
    s3 >>>= 0;
    const t = (s0 + s1) | 0;
    s0 = s1 ^ (s1 >>> 9);
    s1 = (s2 + (s2 << 3)) | 0;
    s2 = (s2 << 21) | (s2 >>> 11);
    s3 = (s3 + 1) | 0;
    const u = (t + s3) | 0;
    s2 = (s2 + u) | 0;
    return (u >>> 0) / 4294967296;
  };
}

export interface SeededRandom {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, boundExclusive). Returns 0 when bound <= 1. */
  nextInt(boundExclusive: number): number;
}

export function createSeededRandom(seed: string): SeededRandom {
  const seeder = xmur3(seed);
  const raw = sfc32(seeder(), seeder(), seeder(), seeder());
  // Discard the first few outputs so short seeds do not correlate.
  for (let i = 0; i < 16; i += 1) raw();
  return {
    next: raw,
    nextInt(boundExclusive: number): number {
      if (boundExclusive <= 1) return 0;
      return Math.floor(raw() * boundExclusive) % boundExclusive;
    },
  };
}

/**
 * Stable 32-bit hash of a string. Used where a value must be reproducible
 * without depending on how many times the PRNG has already been advanced
 * (group names, icebreakers), which keeps naming stable across algorithm
 * tweaks that change PRNG call counts.
 */
export function stableHash(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

export function hashToIndex(value: string, boundExclusive: number): number {
  if (boundExclusive <= 1) return 0;
  return stableHash(value) % boundExclusive;
}

/** Fisher-Yates over a copy. Input order is preserved for the caller. */
export function seededShuffle<T>(items: readonly T[], random: SeededRandom): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = random.nextInt(i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}
