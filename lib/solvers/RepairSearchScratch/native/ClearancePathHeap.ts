export type ClearancePathSearchNode = {
  id: number
  cost: number
  priority: number
}

/** One pending entry per grid state, with in-place priority decreases. */
export class ClearancePathHeap {
  private readonly values: ClearancePathSearchNode[] = []
  private readonly positions?: Map<number, number>
  private readonly densePositions?: Int32Array
  private reusableEntries = true

  constructor(nodeCount?: number) {
    if (nodeCount === undefined) {
      this.positions = new Map<number, number>()
    } else {
      if (!Number.isSafeInteger(nodeCount) || nodeCount <= 0) {
        throw new Error(
          "repair04: dense path queue requires a positive grid size",
        )
      }
      this.densePositions = new Int32Array(nodeCount)
    }
  }

  get length(): number {
    return this.values.length
  }

  push(value: ClearancePathSearchNode): void {
    // Object pushes retain caller ownership. Scalar decreases must not mutate
    // those objects while they remain queued or after they have been popped.
    this.reusableEntries = false
    const id = value.id
    const indices = this.densePositions
    const index = indices
      ? indices[id] === 0
        ? undefined
        : indices[id]! - 1
      : this.positions!.get(id)
    this.insert(value, index)
  }

  /** Internal search enqueue: queued entries are owned by this heap. */
  pushValues(id: number, cost: number, priority: number): void {
    const indices = this.densePositions
    const index = indices
      ? indices[id] === 0
        ? undefined
        : indices[id]! - 1
      : this.positions!.get(id)
    const previous = index === undefined ? undefined : this.values[index]!
    if (previous && priority > previous.priority)
      throw new Error("repair04: queued path priorities may only decrease")
    const value =
      this.reusableEntries && previous ? previous : { id, cost, priority }
    value.id = id
    value.cost = cost
    value.priority = priority
    this.insert(value, index)
  }

  private insert(
    value: ClearancePathSearchNode,
    index: number | undefined,
  ): void {
    const indices = this.densePositions
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
      if (indices) indices[parentValue.id] = index + 1
      else this.positions!.set(parentValue.id, index)
      index = parent
    }
    this.values[index] = value
    if (indices) indices[value.id] = index + 1
    else this.positions!.set(value.id, index)
  }

  pop(): ClearancePathSearchNode {
    const first = this.values[0]
    if (!first) throw new Error("repair04: cannot pop an empty path queue")
    const last = this.values.pop()!
    const indices = this.densePositions
    if (indices) indices[first.id] = 0
    else this.positions!.delete(first.id)
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
        if (indices) indices[childValue.id] = index + 1
        else this.positions!.set(childValue.id, index)
        index = child
      }
      this.values[index] = last
      if (indices) indices[last.id] = index + 1
      else this.positions!.set(last.id, index)
    } else this.reusableEntries = true
    return first
  }
}
