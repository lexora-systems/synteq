export class TtlCache<TValue> {
  private readonly data = new Map<string, { expiresAt: number; value: TValue; createdAt: number }>();

  constructor(private readonly maxSize = 10_000) {}

  set(key: string, value: TValue, ttlSec: number) {
    const now = Date.now();
    this.data.set(key, {
      value,
      createdAt: now,
      expiresAt: now + ttlSec * 1000
    });

    this.compact();
  }

  get(key: string): TValue | undefined {
    const entry = this.data.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return undefined;
    }

    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.data.delete(key);
  }

  size(): number {
    return this.data.size;
  }

  private compact() {
    const now = Date.now();
    for (const [key, entry] of this.data.entries()) {
      if (entry.expiresAt <= now) {
        this.data.delete(key);
      }
    }

    if (this.data.size <= this.maxSize) {
      return;
    }

    const overflow = this.data.size - this.maxSize;
    const oldest = [...this.data.entries()]
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
      .slice(0, overflow);

    for (const [key] of oldest) {
      this.data.delete(key);
    }
  }
}
