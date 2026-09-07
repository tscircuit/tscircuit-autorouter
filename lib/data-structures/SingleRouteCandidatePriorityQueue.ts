export type Node = {
  x: number
  y: number
  z: number

  g: number
  h: number
  f: number

  parent: Node | null
}

export class SingleRouteCandidatePriorityQueue<T extends Node = Node> {
  private heap: T[] = []
  private priorities: Float64Array | null

  constructor(nodes: T[], options?: { cachePriorities?: boolean }) {
    this.heap = []
    // Routing candidates have fixed costs after enqueueing. Keep those costs
    // contiguous so heap comparisons do not chase references to search nodes.
    this.priorities = options?.cachePriorities ? new Float64Array(64) : null

    for (const node of nodes) {
      this.enqueue(node)
    }
  }

  // Removing an element will remove the
  // top element with highest priority then
  // heapifyDown will be called
  dequeue(): T | null {
    if (this.heap.length === 0) {
      return null
    }
    const item = this.heap[0]
    this.heap[0] = this.heap[this.heap.length - 1]
    if (this.priorities) {
      this.priorities[0] = this.priorities[this.heap.length - 1]
    }
    this.heap.pop()
    this.heapifyDown()
    return item
  }

  peek(): T | null {
    if (this.heap.length === 0) {
      return null
    }
    return this.heap[0]
  }

  enqueue(item: T) {
    if (this.priorities) {
      if (this.heap.length === this.priorities.length) {
        const priorities = new Float64Array(this.priorities.length * 2)
        priorities.set(this.priorities)
        this.priorities = priorities
      }
      this.priorities[this.heap.length] = item.f
    }
    this.heap.push(item)
    this.heapifyUp()
  }

  heapifyUp() {
    let index = this.heap.length - 1
    const item = this.heap[index]
    const priorities = this.priorities
    const itemPriority = priorities ? priorities[index] : item.f
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      const parent = this.heap[parentIndex]
      const parentPriority = priorities ? priorities[parentIndex] : parent.f
      if (parentPriority <= itemPriority) break
      this.heap[index] = parent
      if (priorities) priorities[index] = parentPriority
      index = parentIndex
    }
    this.heap[index] = item
    if (priorities) priorities[index] = itemPriority
  }

  heapifyDown() {
    let index = 0
    const heapLength = this.heap.length
    const item = this.heap[index]
    if (!item) return
    const priorities = this.priorities
    const itemPriority = priorities ? priorities[index] : item.f
    while (true) {
      const leftChildIndex = 2 * index + 1
      if (leftChildIndex >= heapLength) break
      const rightChildIndex = leftChildIndex + 1
      let smallerChildIndex = leftChildIndex
      const leftPriority = priorities
        ? priorities[leftChildIndex]
        : this.heap[leftChildIndex].f
      if (
        rightChildIndex < heapLength &&
        (priorities ? priorities[rightChildIndex] : this.heap[rightChildIndex].f) <
          leftPriority
      ) {
        smallerChildIndex = rightChildIndex
      }
      const childPriority = priorities
        ? priorities[smallerChildIndex]
        : this.heap[smallerChildIndex].f
      if (itemPriority < childPriority) {
        break
      }
      this.heap[index] = this.heap[smallerChildIndex]
      if (priorities) priorities[index] = childPriority
      index = smallerChildIndex
    }
    this.heap[index] = item
    if (priorities) priorities[index] = itemPriority
  }

  /**
   * Returns the top N candidates sorted by f value (lowest first)
   */
  getTopN(n: number): T[] {
    return [...this.heap].sort((a, b) => a.f - b.f).slice(0, n)
  }
}
