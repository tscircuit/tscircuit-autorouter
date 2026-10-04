import {
  type Node,
  SingleRouteCandidatePriorityQueue,
} from "lib/data-structures/SingleRouteCandidatePriorityQueue"

type FrontierDiagnostics = {
  keyedEnqueues: number
  inserted: number
  replaced: number
  dominated: number
  equalPriorityRetained: number
  dequeued: number
  maximumSize: number
}

type IndexedCandidateSlot = {
  key: number
  index: number
  priority: number
}

export class SingleHighDensityRouteCandidateQueue extends SingleRouteCandidatePriorityQueue {
  private frontier: Node[] = []
  private slots: Array<IndexedCandidateSlot | undefined> = []
  private positions = new Map<number, IndexedCandidateSlot>()
  private indexingEnabled = true
  private originalMethods = false
  private readonly getKey: (node: Node) => number
  readonly diagnostics: FrontierDiagnostics = {
    keyedEnqueues: 0,
    inserted: 0,
    replaced: 0,
    dominated: 0,
    equalPriorityRetained: 0,
    dequeued: 0,
    maximumSize: 0,
  }

  constructor(nodes: Node[], getKey: (node: Node) => number) {
    super([])
    this.getKey = getKey
    // Keep the original queue's runtime storage on the same array. Explicit
    // prototype calls and the compatibility path operate on these live nodes.
    const originalStorage = this as unknown as { heap: Node[] }
    originalStorage.heap = this.frontier
    if (!SingleHighDensityRouteCandidateQueue.hasNativeQueueMethods()) {
      this.useOriginalQueueMethods()
    }
    for (const node of nodes) {
      if (this.originalMethods) {
        this.enqueue(node)
        continue
      }
      if (!Number.isFinite(node.f)) this.disableIndexing()
      this.append(node, undefined)
    }
  }

  enqueueKeyed(node: Node): void {
    this.diagnostics.keyedEnqueues++
    if (!SingleHighDensityRouteCandidateQueue.hasNativeQueueMethods()) {
      this.useOriginalQueueMethods()
    }
    if (this.originalMethods) {
      this.enqueue(node)
      return
    }
    if (
      this.heapifyUp !== nativeHeapifyUp ||
      this.heapifyDown !== nativeHeapifyDown
    ) {
      this.disableIndexing()
    }
    if (!Number.isFinite(node.f)) {
      // A non-finite priority does not define a total heap order. Preserve
      // the original policy for the complete frontier in that case.
      this.disableIndexing()
    }
    if (!this.indexingEnabled) {
      this.append(node, undefined)
      return
    }
    const key = this.getKey(node)
    if (!Number.isSafeInteger(key)) {
      this.append(node, undefined)
      return
    }
    const slot = this.positions.get(key)
    if (slot !== undefined) {
      const queued = this.frontier[slot.index]
      // Public node values stay live. A changed key or non-finite priority
      // cannot establish dominance over another candidate.
      if (this.getKey(queued) !== key || queued.f !== slot.priority) {
        this.useOriginalQueueMethods()
        this.enqueue(node)
        return
      } else if (node.f > queued.f) {
        this.diagnostics.dominated++
        return
      } else if (node.f < queued.f) {
        this.frontier[slot.index] = node
        slot.priority = node.f
        this.diagnostics.replaced++
        this.moveUp(slot.index)
        return
      } else {
        // Preserve equal-priority candidates: their parent and the binary
        // heap's existing tie order can select different valid routes.
        this.diagnostics.equalPriorityRetained++
        this.append(node, undefined)
        return
      }
    }
    this.append(node, key)
  }

  override enqueue(node: Node): void {
    // External queue operations may retain or mutate node objects. Continue
    // with the original unkeyed heap policy after the public API is used.
    this.useOriginalQueueMethods()
    SingleRouteCandidatePriorityQueue.prototype.enqueue.call(this, node)
    this.diagnostics.inserted++
    this.diagnostics.maximumSize = Math.max(
      this.diagnostics.maximumSize,
      this.frontier.length,
    )
  }

  override dequeue(): Node | null {
    if (!SingleHighDensityRouteCandidateQueue.hasNativeQueueMethods()) {
      this.useOriginalQueueMethods()
    }
    if (this.originalMethods) {
      const node = SingleRouteCandidatePriorityQueue.prototype.dequeue.call(this)
      if (node) this.diagnostics.dequeued++
      return node
    }
    if (this.frontier.length === 0) return null
    const node = this.frontier[0]
    const slot = this.slots[0]
    if (slot !== undefined && this.positions.get(slot.key) === slot) {
      this.positions.delete(slot.key)
    }
    const lastIndex = this.frontier.length - 1
    this.frontier[0] = this.frontier[lastIndex]
    this.slots[0] = this.slots[lastIndex]
    this.frontier.pop()
    this.slots.pop()
    const rootSlot = this.slots[0]
    if (rootSlot !== undefined) rootSlot.index = 0
    this.heapifyDown()
    this.diagnostics.dequeued++
    return node
  }

  override peek(): Node | null {
    this.useOriginalQueueMethods()
    const peek = SingleRouteCandidatePriorityQueue.prototype.peek
    const node = peek.call(this)
    return node
  }

  override getTopN(n: number): Node[] {
    this.useOriginalQueueMethods()
    const getTopN = SingleRouteCandidatePriorityQueue.prototype.getTopN
    const nodes = getTopN.call(this, n)
    return nodes
  }

  override heapifyUp(): void {
    if (this.frontier.length !== this.slots.length) {
      this.useOriginalQueueMethods()
    }
    if (this.originalMethods) {
      SingleRouteCandidatePriorityQueue.prototype.heapifyUp.call(this)
      return
    }
    const index = this.frontier.length - 1
    if (index < 0) {
      return
    }
    this.moveUp(index)
  }

  override heapifyDown(): void {
    if (this.frontier.length !== this.slots.length) {
      this.useOriginalQueueMethods()
    }
    if (this.originalMethods) {
      SingleRouteCandidatePriorityQueue.prototype.heapifyDown.call(this)
      return
    }
    let index = 0
    const length = this.frontier.length
    const node = this.frontier[index]
    const slot = this.slots[index]
    if (!node) return
    while (true) {
      const left = 2 * index + 1
      if (left >= length) break
      const right = left + 1
      let child = left
      if (
        right < length &&
        this.frontier[right].f < this.frontier[left].f
      ) {
        child = right
      }
      if (node.f < this.frontier[child].f) break
      this.frontier[index] = this.frontier[child]
      this.slots[index] = this.slots[child]
      const childSlot = this.slots[index]
      if (childSlot !== undefined) childSlot.index = index
      index = child
    }
    this.frontier[index] = node
    this.slots[index] = slot
    if (slot !== undefined) slot.index = index
  }

  private append(node: Node, key: number | undefined): void {
    const index = this.frontier.length
    const slot =
      key === undefined ? undefined : { key, index, priority: node.f }
    this.frontier.push(node)
    this.slots.push(slot)
    if (slot !== undefined) this.positions.set(slot.key, slot)
    this.heapifyUp()
    this.diagnostics.inserted++
    this.diagnostics.maximumSize = Math.max(
      this.diagnostics.maximumSize,
      this.frontier.length,
    )
  }

  private moveUp(startIndex: number): void {
    let index = startIndex
    const node = this.frontier[index]
    const slot = this.slots[index]
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      const parent = this.frontier[parentIndex]
      if (parent.f <= node.f) break
      this.frontier[index] = parent
      this.slots[index] = this.slots[parentIndex]
      const parentSlot = this.slots[index]
      if (parentSlot !== undefined) parentSlot.index = index
      index = parentIndex
    }
    this.frontier[index] = node
    this.slots[index] = slot
    if (slot !== undefined) slot.index = index
  }

  disableIndexing(): void {
    if (!this.indexingEnabled) {
      return
    }
    this.indexingEnabled = false
    this.positions.clear()
    this.slots.fill(undefined)
  }

  useOriginalQueueMethods(): void {
    this.disableIndexing()
    this.originalMethods = true
    // The public generic queue methods own heap maintenance from this point.
    // No indexed bookkeeping is retained after callers can mutate the heap.
    this.slots.length = 0
  }

  static hasNativeQueueMethods(): boolean {
    return (
      SingleRouteCandidatePriorityQueue.prototype.enqueue === nativeEnqueue &&
      SingleRouteCandidatePriorityQueue.prototype.dequeue === nativeDequeue &&
      SingleRouteCandidatePriorityQueue.prototype.heapifyUp === nativeGenericUp &&
      SingleRouteCandidatePriorityQueue.prototype.heapifyDown === nativeGenericDown
    )
  }
}

const nativeHeapifyUp = SingleHighDensityRouteCandidateQueue.prototype.heapifyUp
const nativeHeapifyDown =
  SingleHighDensityRouteCandidateQueue.prototype.heapifyDown
const nativeEnqueue = SingleRouteCandidatePriorityQueue.prototype.enqueue
const nativeDequeue = SingleRouteCandidatePriorityQueue.prototype.dequeue
const nativeGenericUp = SingleRouteCandidatePriorityQueue.prototype.heapifyUp
const nativeGenericDown = SingleRouteCandidatePriorityQueue.prototype.heapifyDown
