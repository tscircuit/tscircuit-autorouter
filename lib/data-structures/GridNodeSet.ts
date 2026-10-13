/** Cache bounded grid membership while retaining the complete Set interface. */
export class GridNodeSet extends Set<number> {
  private readonly bits: Uint8Array

  constructor(
    private readonly nodeCount: number,
    initialValues: ReadonlySet<number> = new Set(),
  ) {
    super()
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

  override has(key: number): boolean {
    if (Number.isInteger(key) && key >= 0 && key < this.nodeCount) {
      return (this.bits[key >>> 3]! & (1 << (key & 7))) !== 0
    }
    return super.has(key)
  }

  override add(key: number): this {
    if (Number.isInteger(key) && key >= 0 && key < this.nodeCount) {
      this.bits[key >>> 3]! |= 1 << (key & 7)
    }
    super.add(key)
    return this
  }

  override delete(key: number): boolean {
    if (Number.isInteger(key) && key >= 0 && key < this.nodeCount) {
      this.bits[key >>> 3]! &= ~(1 << (key & 7))
    }
    return super.delete(key)
  }

  override clear(): void {
    this.bits.fill(0)
    // Set owns insertion order, iteration, and the sparse numeric keys.
    // Clear both representations so later additions begin a fresh search.
    super.clear()
  }
}
