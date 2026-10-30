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
  // Search-node priorities are fixed while queued. Keep them contiguous so
  // sifts do not chase node objects and their retained parent paths.
  private costs: number[] = []

  constructor(nodes: T[]) {
    this.heap = []

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
    this.heap.pop()
    this.costs[0] = this.costs[this.costs.length - 1]
    this.costs.pop()
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
    this.heap.push(item)
    this.costs.push(item.f)
    this.heapifyUp()
  }

  heapifyUp() {
    let index = this.heap.length - 1
    const item = this.heap[index]
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      const parent = this.heap[parentIndex]
      if (this.costs[parentIndex] <= item.f) break
      this.costs[index] = this.costs[parentIndex]
      this.heap[index] = parent
      index = parentIndex
    }
    this.heap[index] = item
    this.costs[index] = item.f
  }

  heapifyDown() {
    let index = 0
    const heapLength = this.heap.length
    const item = this.heap[index]
    if (!item) return
    while (true) {
      const leftChildIndex = 2 * index + 1
      if (leftChildIndex >= heapLength) break
      const rightChildIndex = leftChildIndex + 1
      let smallerChildIndex = leftChildIndex
      if (
        rightChildIndex < heapLength &&
        this.costs[rightChildIndex] < this.costs[leftChildIndex]
      ) {
        smallerChildIndex = rightChildIndex
      }
      if (item.f < this.costs[smallerChildIndex]) {
        break
      }
      this.heap[index] = this.heap[smallerChildIndex]
      this.costs[index] = this.costs[smallerChildIndex]
      index = smallerChildIndex
    }
    this.heap[index] = item
    this.costs[index] = item.f
  }

  /**
   * Returns the top N candidates sorted by f value (lowest first)
   */
  getTopN(n: number): T[] {
    return [...this.heap].sort((a, b) => a.f - b.f).slice(0, n)
  }
}
