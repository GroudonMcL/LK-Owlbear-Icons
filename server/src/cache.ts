/** A small TTL cache with LRU eviction by entry count and optional weight. */
export class TtlCache<K, V> {
  private readonly entries = new Map<K, { value: V; expires: number; weight: number }>();
  private totalWeight = 0;

  constructor(
    private readonly options: {
      ttlMs: number;
      maxEntries: number;
      maxWeight?: number;
      weigh?: (value: V) => number;
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.delete(key);
      return undefined;
    }
    // Re-insert to mark as most recently used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.delete(key);
    const weight = this.options.weigh ? this.options.weigh(value) : 1;
    if (this.options.maxWeight !== undefined && weight > this.options.maxWeight) return;
    this.entries.set(key, { value, expires: this.now() + this.options.ttlMs, weight });
    this.totalWeight += weight;
    while (
      this.entries.size > this.options.maxEntries ||
      (this.options.maxWeight !== undefined && this.totalWeight > this.options.maxWeight)
    ) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
  }

  delete(key: K): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.totalWeight -= entry.weight;
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Collapses concurrent identical requests into one promise, so a burst of
 * thumbnail or page requests results in a single upstream call.
 */
export class InFlight<K, V> {
  private readonly pending = new Map<K, Promise<V>>();

  run(key: K, task: () => Promise<V>): Promise<V> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = task().finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
}
