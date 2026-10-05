export type Node = {
  f: number
  // Other properties can exist here, but 'f' is required for prioritization
  [key: string]: any // Allow other properties
}

export class PriorityQueue<T extends Node = Node> {
  // Store the heap as an array. Index 0 is the root (highest priority/smallest 'f').
  private heap: T[] = []
  private maxSize: number

  /**
   * Creates a new Priority Queue.
   * @param nodes An optional initial array of nodes to populate the queue.
   * @param maxSize The maximum number of elements the queue can hold. Defaults to 10,000.
   */
  constructor(nodes: T[] = [], maxSize = 10_000) {
    this.maxSize = maxSize
    // More efficient heap construction (Heapify) - O(n)
    if (nodes.length > 0) {
      // Ensure initial nodes don't exceed maxSize immediately
      this.heap = [...nodes].sort((a, b) => a.f - b.f).slice(0, this.maxSize)
      // Build the heap property starting from the last non-leaf node
      for (let i = Math.floor(this.heap.length / 2) - 1; i >= 0; i--) {
        this._siftDown(i)
      }
    }

    // Less efficient alternative (n log n) - kept for reference
    // if (nodes) {
    //   nodes.forEach(node => this.enqueue(node));
    // }
  }

  /**
   * Returns the number of elements currently in the queue.
   */
  get size(): number {
    return this.heap.length
  }

  /**
   * Checks if the queue is empty.
   */
  isEmpty(): boolean {
    return this.heap.length === 0
  }

  /**
   * Returns the node with the highest priority (smallest 'f') without removing it.
   * Returns null if the queue is empty.
   * @returns The highest priority node or null.
   */
  peek(): T | null {
    if (this.isEmpty()) {
      return null
    }
    return this.heap[0]
  }

  /**
   * Removes and returns the node with the highest priority (smallest 'f').
   * Returns null if the queue is empty.
   * Maintains the heap property.
   * @returns The highest priority node or null.
   */
  dequeue(): T | null {
    if (this.isEmpty()) {
      return null
    }

    const minNode = this.heap[0]
    const lastNode = this.heap.pop() // Remove last element

    // If heap is now empty (was size 1), just return the minNode
    if (this.heap.length === 0 && lastNode !== undefined) {
      // This branch means pop() removed the only element, which was minNode
      return minNode
    }
    // If heap is not empty after pop(), move the last node to the root
    // Use non-null assertion as we know pop returned a value if heap wasn't empty before
    if (lastNode !== undefined) {
      this.heap[0] = lastNode
      this._siftDown(0) // Restore heap property from the root
    }

    return minNode
  }

  /**
   * Adds a new node to the queue.
   * Maintains the heap property.
   * If the queue is full (at maxSize), the node is not added.
   * @param node The node to add.
   */
  enqueue(node: T): void {
    if (this.heap.length >= this.maxSize) {
      // Optional: Could implement logic here to replace the *worst* node
      // if the new node is better, but current spec is just to not add.
      // console.warn("Priority Queue is full. Cannot enqueue node.");
      return
    }

    this.heap.push(node) // Add to the end
    this._siftUp(this.heap.length - 1) // Restore heap property from the new node
  }

  // --- Private Helper Methods ---

  /**
   * Moves the node at the given index up the heap to maintain the heap property.
   * @param index The index of the node to sift up.
   */
  private _siftUp(index: number): void {
    let currentIndex = index
    while (currentIndex > 0) {
      const parentIndex = this._parentIndex(currentIndex)
      // If parent's f is smaller or equal, heap property is satisfied
      if (this.heap[parentIndex].f <= this.heap[currentIndex].f) {
        break
      }
      // Otherwise, swap and continue sifting up
      this._swap(currentIndex, parentIndex)
      currentIndex = parentIndex
    }
  }

  /**
   * Moves the node at the given index down the heap to maintain the heap property.
   * @param index The index of the node to sift down.
   */
  private _siftDown(index: number): void {
    let currentIndex = index
    const heapSize = this.heap.length

    while (true) {
      const leftChildIndex = this._leftChildIndex(currentIndex)
      const rightChildIndex = this._rightChildIndex(currentIndex)
      let smallestIndex = currentIndex // Assume current is smallest

      // Check left child
      if (
        leftChildIndex < heapSize &&
        this.heap[leftChildIndex].f < this.heap[smallestIndex].f
      ) {
        smallestIndex = leftChildIndex
      }

      // Check right child
      if (
        rightChildIndex < heapSize &&
        this.heap[rightChildIndex].f < this.heap[smallestIndex].f
      ) {
        smallestIndex = rightChildIndex
      }

      // If the smallest is not the current node, swap and continue sifting down
      if (smallestIndex !== currentIndex) {
        this._swap(currentIndex, smallestIndex)
        currentIndex = smallestIndex // Move down to the swapped position
      } else {
        // Heap property is satisfied for this subtree
        break
      }
    }
  }

  /**
   * Swaps two elements in the heap array.
   * @param i Index of the first element.
   * @param j Index of the second element.
   */
  private _swap(i: number, j: number): void {
    ;[this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]]
  }

  /** Calculates the parent index of a node. */
  private _parentIndex(index: number): number {
    return Math.floor((index - 1) / 2)
  }

  /** Calculates the left child index of a node. */
  private _leftChildIndex(index: number): number {
    return 2 * index + 1
  }

  /** Calculates the right child index of a node. */
  private _rightChildIndex(index: number): number {
    return 2 * index + 2
  }
}
