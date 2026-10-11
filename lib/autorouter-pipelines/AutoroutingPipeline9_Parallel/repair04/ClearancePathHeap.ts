/**
 * Copied from @tscircuit/repair04 at
 * 81d4585d335ea1958a1c6569e4064c58cba44bad (MIT, see ./LICENSE).
 * These private helpers are not exposed by that package's exports map.
 */
export type ClearancePathSearchNode = {
  id: number
  cost: number
  priority: number
}

/** One pending entry per grid state, with in-place priority decreases. */
export class ClearancePathHeap {
  private readonly values: ClearancePathSearchNode[] = []
  private readonly positions = new Map<number, number>()
  private readonly densePositions?: Int32Array
  private denseIds?: Int32Array
  private denseCosts?: Float64Array
  private densePriorities?: Float64Array
  private denseCount = 0

  constructor(nodeCount?: number) {
    if (nodeCount !== undefined) {
      if (!Number.isSafeInteger(nodeCount) || nodeCount <= 0) {
        throw new Error(
          "repair04: dense path queue requires a positive grid size",
        )
      }
      this.densePositions = new Int32Array(nodeCount)
      const capacity = Math.min(256, nodeCount)
      this.denseIds = new Int32Array(capacity)
      this.denseCosts = new Float64Array(capacity)
      this.densePriorities = new Float64Array(capacity)
    }
  }

  get length(): number {
    return this.densePositions ? this.denseCount : this.values.length
  }

  push(value: ClearancePathSearchNode): void {
    if (this.densePositions) {
      this.pushValues(value.id, value.cost, value.priority)
      return
    }
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
    if (this.densePositions) return this.popInto({ id: 0, cost: 0, priority: 0 })
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

  /** Internal search callers can avoid allocating a node for each queue update. */
  pushValues(id: number, cost: number, priority: number): void {
    const positions = this.densePositions
    if (!positions) {
      this.push({ id, cost, priority })
      return
    }
    let index = positions[id]! - 1
    if (index === -1) {
      index = this.denseCount
      this.reserveDenseCapacity(this.denseCount + 1)
      this.denseCount++
    } else if (priority > this.densePriorities![index]!) {
      throw new Error("repair04: queued path priorities may only decrease")
    }
    const ids = this.denseIds!, costs = this.denseCosts!, priorities = this.densePriorities!
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (priorities[parent]! <= priority) break
      const parentId = ids[parent]!
      ids[index] = parentId
      costs[index] = costs[parent]!
      priorities[index] = priorities[parent]!
      positions[parentId] = index + 1
      index = parent
    }
    ids[index] = id
    costs[index] = cost
    priorities[index] = priority
    positions[id] = index + 1
  }

  /** Copies the original minimum into caller-owned scratch without retaining it. */
  popInto(output: ClearancePathSearchNode): ClearancePathSearchNode {
    const positions = this.densePositions
    if (!positions) {
      const first = this.pop()
      output.id = first.id
      output.cost = first.cost
      output.priority = first.priority
      return output
    }
    if (this.denseCount === 0) throw new Error("repair04: cannot pop an empty path queue")
    const ids = this.denseIds!, costs = this.denseCosts!, priorities = this.densePriorities!
    output.id = ids[0]!
    output.cost = costs[0]!
    output.priority = priorities[0]!
    positions[output.id] = 0
    const lastIndex = --this.denseCount
    const lastId = ids[lastIndex]!, lastCost = costs[lastIndex]!, lastPriority = priorities[lastIndex]!
    if (this.denseCount > 0) {
      let index = 0
      while (index * 2 + 1 < this.denseCount) {
        let child = index * 2 + 1
        if (child + 1 < this.denseCount && priorities[child + 1]! < priorities[child]!) child++
        if (priorities[child]! >= lastPriority) break
        const childId = ids[child]!
        ids[index] = childId
        costs[index] = costs[child]!
        priorities[index] = priorities[child]!
        positions[childId] = index + 1
        index = child
      }
      ids[index] = lastId
      costs[index] = lastCost
      priorities[index] = lastPriority
      positions[lastId] = index + 1
    }
    return output
  }

  private reserveDenseCapacity(required: number): void {
    const previousIds = this.denseIds!
    if (required <= previousIds.length) return
    const capacity = Math.min(this.densePositions!.length, Math.max(required, previousIds.length * 2))
    if (capacity < required) throw new Error("repair04: dense path queue exceeded its grid capacity")
    const ids = new Int32Array(capacity), costs = new Float64Array(capacity), priorities = new Float64Array(capacity)
    ids.set(previousIds)
    costs.set(this.denseCosts!)
    priorities.set(this.densePriorities!)
    this.denseIds = ids
    this.denseCosts = costs
    this.densePriorities = priorities
  }
}
