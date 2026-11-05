import { sha256 } from '@ctt/shared';

/**
 * Small seeded pseudo-random generator (mulberry32). Not for security; for
 * reproducibility: the same seed string always gives the same sequence, on any
 * machine and any Node version, unlike Math.random().
 */
export class Rng {
  private state: number;

  constructor(seed: string) {
    this.state = Number.parseInt(sha256(seed).slice(0, 8), 16);
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length - 1)];
    if (item === undefined) throw new Error('pick from an empty list');
    return item;
  }

  /** n distinct items, in random order (partial Fisher-Yates on a copy). */
  sample<T>(items: readonly T[], n: number): T[] {
    if (n > items.length) throw new Error(`cannot sample ${n} from ${items.length}`);
    const copy = [...items];
    for (let i = 0; i < n; i++) {
      const j = this.int(i, copy.length - 1);
      [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
    }
    return copy.slice(0, n);
  }
}
