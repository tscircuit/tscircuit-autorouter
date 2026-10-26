/** Ordered Set with a paged membership mirror for owned Native searches. */
export class NativeExploredNodeSet extends Set<number> {
  private readonly pages: Array<Uint32Array | undefined>

  constructor(private readonly keyLimit: number) {
    super()
    this.pages = new Array(Math.ceil(keyLimit / 1024))
  }

  override has(key: number): boolean {
    if ((key >>> 0) === key && key < this.keyLimit) {
      const page = this.pages[key >>> 10]
      return (
        page !== undefined &&
        (page[(key >>> 5) & 31]! & (1 << (key & 31))) !== 0
      )
    }
    return super.has(key)
  }

  override add(key: number): this {
    super.add(key)
    if ((key >>> 0) === key && key < this.keyLimit) {
      const pageIndex = key >>> 10
      const page = (this.pages[pageIndex] ??= new Uint32Array(32))
      page[(key >>> 5) & 31] |= 1 << (key & 31)
    }
    return this
  }

  override delete(key: number): boolean {
    const deleted = super.delete(key)
    if ((key >>> 0) === key && key < this.keyLimit) {
      const page = this.pages[key >>> 10]
      if (page !== undefined) {
        page[(key >>> 5) & 31] &= ~(1 << (key & 31))
      }
    }
    return deleted
  }

  override clear(): void {
    super.clear()
    this.pages.fill(undefined)
  }
}
