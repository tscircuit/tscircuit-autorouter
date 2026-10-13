/** Compact membership and insertion order for internal grid searches. */
export class GridNodeSet implements Iterable<number> {
  private readonly bits: Uint8Array
  private readonly insertionOrder: number[] = []
  private readonly sparse = new Set<number>()

  constructor(
    private readonly nodeCount: number,
    initialValues: ReadonlySet<number> = new Set(),
  ) {
    if (
      !Number.isSafeInteger(nodeCount) ||
      nodeCount <= 0 ||
      nodeCount > 2 ** 32
    ) {
      throw new Error("Grid membership requires a positive uint32 grid size")
    }
    this.bits = new Uint8Array(Math.ceil(nodeCount / 8))
    for (const key of initialValues) this.add(key)
  }

  has(key: number): boolean {
    if (Number.isInteger(key) && key >= 0 && key < this.nodeCount) {
      return (this.bits[key >>> 3]! & (1 << (key & 7))) !== 0
    }
    return this.sparse.has(key)
  }

  add(key: number): this {
    if (this.has(key)) return this
    if (Number.isInteger(key) && key >= 0 && key < this.nodeCount) {
      this.bits[key >>> 3]! |= 1 << (key & 7)
    } else {
      this.sparse.add(key)
    }
    this.insertionOrder.push(key === 0 ? 0 : key)
    return this
  }

  *[Symbol.iterator](): IterableIterator<number> {
    // Materialization must preserve the native Set's exact insertion order.
    for (const key of this.insertionOrder) {
      yield key
    }
  }
}
