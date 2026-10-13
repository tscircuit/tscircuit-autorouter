/** Membership for bounded grid keys, with sparse storage for other numbers. */
export class GridNodeSet {
  private readonly bits: Uint8Array

  constructor(
    private readonly nodeCount: number,
    private readonly sparse: Set<number> = new Set(),
  ) {
    if (
      !Number.isSafeInteger(nodeCount) ||
      nodeCount <= 0 ||
      nodeCount > 2 ** 32
    ) {
      throw new Error("Grid membership requires a positive uint32 grid size")
    }
    this.bits = new Uint8Array(Math.ceil(nodeCount / 8))
    for (const key of sparse) this.add(key)
  }

  has(key: number): boolean {
    if (Number.isInteger(key) && key >= 0 && key < this.nodeCount) {
      return (this.bits[key >>> 3]! & (1 << (key & 7))) !== 0
    }
    return this.sparse.has(key)
  }

  add(key: number): this {
    if (Number.isInteger(key) && key >= 0 && key < this.nodeCount) {
      this.bits[key >>> 3]! |= 1 << (key & 7)
    } else {
      this.sparse.add(key)
    }
    return this
  }
}
