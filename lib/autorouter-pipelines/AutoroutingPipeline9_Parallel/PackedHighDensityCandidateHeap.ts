import {
  type Node,
  SingleRouteCandidatePriorityQueue,
} from "../../data-structures/SingleRouteCandidatePriorityQueue"

/** Internal queue for immutable, accepted grid candidates. */
export class PackedHighDensityCandidateHeap extends SingleRouteCandidatePriorityQueue {
  private readonly nodes: Node[] = []
  private priorities = new Float64Array(32)

  constructor(nodes: Node[]) {
    super([])
    for (const node of nodes) this.enqueue(node)
  }

  override enqueue(node: Node): void {
    let index = this.nodes.length
    if (index === this.priorities.length) {
      const next = new Float64Array(this.priorities.length * 2)
      next.set(this.priorities)
      this.priorities = next
    }
    const priority = node.f
    this.nodes.push(node)
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      const parentPriority = this.priorities[parentIndex]!
      if (parentPriority <= priority) break
      this.nodes[index] = this.nodes[parentIndex]!
      this.priorities[index] = parentPriority
      index = parentIndex
    }
    this.nodes[index] = node
    this.priorities[index] = priority
  }

  override dequeue(): Node | null {
    const count = this.nodes.length
    if (count === 0) return null
    const first = this.nodes[0]!
    const last = this.nodes[count - 1]!
    const priority = this.priorities[count - 1]!
    this.nodes.pop()
    const remaining = count - 1
    if (remaining === 0) return first
    let index = 0
    while (true) {
      const left = 2 * index + 1
      if (left >= remaining) break
      const right = left + 1
      const child = right < remaining &&
        this.priorities[right]! < this.priorities[left]!
        ? right : left
      const childPriority = this.priorities[child]!
      // The native HD heap descends on equal priorities.
      if (priority < childPriority) break
      this.nodes[index] = this.nodes[child]!
      this.priorities[index] = childPriority
      index = child
    }
    this.nodes[index] = last
    this.priorities[index] = priority
    return first
  }

  override peek(): Node | null {
    return this.nodes[0] ?? null
  }

  override getTopN(n: number): Node[] {
    return [...this.nodes].sort((a, b) => a.f - b.f).slice(0, n)
  }
}
