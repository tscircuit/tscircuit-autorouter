export type ClearancePathSearchNode = {
  id: number
  cost: number
  priority: number
}

/** One pending entry per grid state, with in-place priority decreases. */
export class ClearancePathHeap {
  private readonly values: ClearancePathSearchNode[] = []
  private readonly positions: {
    get(id: number): number | undefined
    set(id: number, index: number): void
    delete(id: number): void
  }

  constructor(nodeCount?: number) {
    if (nodeCount === undefined) {
      this.positions = new Map<number, number>()
    } else {
      if (!Number.isSafeInteger(nodeCount) || nodeCount <= 0) {
        throw new Error(
          "repair04: dense path queue requires a positive grid size",
        )
      }
      const indices = new Int32Array(nodeCount)
      this.positions = {
        get: (id: number): number | undefined =>
          indices[id] === 0 ? undefined : indices[id]! - 1,
        set: (id: number, index: number): void => {
          indices[id] = index + 1
        },
        delete: (id: number): void => {
          indices[id] = 0
        },
      }
    }
  }

  get length(): number {
    return this.values.length
  }

  push(value: ClearancePathSearchNode): void {
    let index = this.positions.get(value.id)
    if (index === undefined) {
      index = this.values.length
      this.values.push(value)
    } else if (value.priority > this.values[index]!.priority) {
      throw new Error("repair04: queued path priorities may only decrease")
    }
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      const parentValue = this.values[parent]!
      if (parentValue.priority <= value.priority) break
      this.values[index] = parentValue
      this.positions.set(parentValue.id, index)
      index = parent
    }
    this.values[index] = value
    this.positions.set(value.id, index)
  }

  pop(): ClearancePathSearchNode {
    const first = this.values[0]
    if (!first) throw new Error("repair04: cannot pop an empty path queue")
    const last = this.values.pop()!
    this.positions.delete(first.id)
    if (this.values.length) {
      let index = 0
      while (index * 2 + 1 < this.values.length) {
        let child = index * 2 + 1
        if (
          child + 1 < this.values.length &&
          this.values[child + 1]!.priority < this.values[child]!.priority
        )
          child++
        const childValue = this.values[child]!
        if (childValue.priority >= last.priority) break
        this.values[index] = childValue
        this.positions.set(childValue.id, index)
        index = child
      }
      this.values[index] = last
      this.positions.set(last.id, index)
    }
    return first
  }
}
