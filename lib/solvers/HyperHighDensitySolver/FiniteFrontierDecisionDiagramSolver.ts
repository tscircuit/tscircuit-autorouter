import { BaseSolver } from "../BaseSolver"

export type FrontierChoice = {
  key: string
  cost: number
  vertices: readonly number[]
  primitives: readonly number[]
}
export type FrontierTask = { connectionName: string; owner: string; start: number; end: number }
export type FrontierStats = Record<string, number>
type FrontierState = {
  masks: readonly bigint[]
  cost: number
  parent: FrontierState | null
  choiceIndex: number
  taskIndex: number
}

/**
 * Exact weighted decision diagram for immutable finite route domains. A state
 * is the set of choices still allowed for EACH remaining pair task. All pair,
 * net, width, layer, order and drill distinctions live in those fixed choices
 * and their exact compatibility relation; no assigned route is forgotten
 * until every future choice's response to it has been projected into a mask.
 */
export class FiniteFrontierDecisionDiagramSolver extends BaseSolver {
  readonly tasks: readonly FrontierTask[]
  readonly domains: readonly (readonly FrontierChoice[])[]
  readonly counters: FrontierStats
  readonly fullMasks: readonly bigint[]
  chosenIndices: number[] = []
  cost = Infinity
  private current: FrontierState[]
  private readonly next = new Map<string, FrontierState>()
  private readonly projectedCompatibility = new Map<string, bigint>()
  private taskIndex = 0
  private stateCursor = 0
  private choiceCursor = 0

  constructor(readonly params: {
    tasks: readonly FrontierTask[]
    domains: readonly (readonly FrontierChoice[])[]
    compatible: (leftTask: number, leftChoice: number, rightTask: number, rightChoice: number) => boolean
    maxIterations: number
    maxStatesPerLayer: number
    counters?: FrontierStats
  }) {
    super()
    if (params.tasks.length !== params.domains.length) throw new Error("A frontier domain is required for every pair task")
    this.tasks = Object.freeze(params.tasks.map((task) => Object.freeze({ ...task })))
    this.domains = Object.freeze(params.domains.map((domain, task) => Object.freeze(domain.map((choice) => {
      if (!Number.isFinite(choice.cost) || choice.cost < 0 || choice.vertices[0] !== this.tasks[task]!.start || choice.vertices.at(-1) !== this.tasks[task]!.end) {
        throw new Error("Frontier route choices require finite costs and exact task endpoints")
      }
      return Object.freeze({ ...choice, vertices: Object.freeze([...choice.vertices]), primitives: Object.freeze([...choice.primitives]) })
    }))))
    this.counters = params.counters ?? {}
    this.stats = this.counters
    this.MAX_ITERATIONS = params.maxIterations
    this.fullMasks = this.domains.map((domain) => (1n << BigInt(domain.length)) - 1n)
    this.current = [{ masks: this.fullMasks, cost: 0, parent: null, choiceIndex: -1, taskIndex: -1 }]
    this.count("frontierInterfaceDiagramCount")
    this.count("frontierInterfaceFrozenTaskDomainCount", this.tasks.length)
    this.count("frontierInterfaceFrozenChoiceCount", this.domains.reduce((sum, domain) => sum + domain.length, 0))
  }

  private count(key: string, amount = 1): void {
    const previous = this.counters[key]
    this.counters[key] = (previous ?? 0) + amount
    // All histories share the same immutable domains and compatibility table.
    // Counters include every attempted, merged and rejected history.
  }

  private projectChoice(choice: number, futureTask: number): bigint {
    const key = `${this.taskIndex}:${choice}:${futureTask}`
    const known = this.projectedCompatibility.get(key)
    if (known !== undefined) return known
    let mask = 0n
    for (let futureChoice = 0; futureChoice < this.domains[futureTask]!.length; futureChoice++) {
      this.count("frontierInterfaceCompatibilityCheckCount")
      if (this.params.compatible(this.taskIndex, choice, futureTask, futureChoice)) mask |= 1n << BigInt(futureChoice)
    }
    this.projectedCompatibility.set(key, mask)
    return mask
  }

  private finishLayer(): void {
    this.current = [...this.next.values()]
    this.next.clear()
    this.taskIndex++
    this.stateCursor = 0
    this.choiceCursor = 0
    this.count("frontierInterfaceCompletedLayerCount")
    if (this.current.length === 0) {
      this.failed = true
      this.error = "Fixed frontier route domains have no compatible assignment; board feasibility remains unknown"
      this.count("frontierInterfaceFiniteDomainExhaustionCount")
      return
    }
    if (this.taskIndex !== this.tasks.length) return
    let state = this.current.reduce((best, candidate) => candidate.cost < best.cost ? candidate : best)
    this.cost = state.cost
    this.chosenIndices = new Array<number>(this.tasks.length).fill(-1)
    while (state.parent) {
      this.chosenIndices[state.taskIndex] = state.choiceIndex
      state = state.parent
    }
    this.solved = true
    this.progress = 1
    this.count("frontierInterfaceSolvedAssignmentCount")
  }

  override _step(): void {
    if (this.tasks.length === 0) {
      this.chosenIndices = []
      this.cost = 0
      this.solved = true
      this.progress = 1
      return
    }
    if (this.stateCursor >= this.current.length || this.domains[this.taskIndex]!.length === 0) {
      this.finishLayer()
      return
    }
    const state = this.current[this.stateCursor]!
    const choiceIndex = this.choiceCursor++
    if (this.choiceCursor === this.domains[this.taskIndex]!.length) {
      this.stateCursor++
      this.choiceCursor = 0
    }
    this.count("frontierInterfaceTransitionAttemptCount")
    if ((state.masks[this.taskIndex]! & (1n << BigInt(choiceIndex))) === 0n) {
      this.count("frontierInterfaceIncompatibleTransitionCount")
      return
    }
    const masks = [...state.masks]
    masks[this.taskIndex] = 0n
    for (let future = this.taskIndex + 1; future < this.tasks.length; future++) {
      masks[future] = masks[future]! & this.projectChoice(choiceIndex, future)
      if (masks[future] === 0n) {
        this.count("frontierInterfaceIncompatibleTransitionCount")
        return
      }
    }
    const key = masks.slice(this.taskIndex + 1).map((mask) => mask.toString(16)).join("/")
    const cost = state.cost + this.domains[this.taskIndex]![choiceIndex]!.cost
    const existing = this.next.get(key)
    if (existing) {
      this.count("frontierInterfaceMergedHistoryCount")
      this.count("frontierInterfaceDominatedHistoryCount")
      if (existing.cost <= cost) return
      this.count("frontierInterfaceLowerCostReplacementCount")
    } else if (this.next.size >= this.params.maxStatesPerLayer) {
      this.failed = true
      this.error = "Frontier state cap exhausted; board feasibility remains unknown"
      this.count("frontierInterfaceStateCapExhaustionCount")
      return
    } else {
      this.count("frontierInterfaceCreatedStateCount")
    }
    // This is a future-extension equivalence, not a cache of completed tasks:
    // for any fixed suffix assignment, both histories accept it or reject it.
    // Retaining the cheaper exact witness therefore preserves the optimum.
    this.next.set(key, { masks, cost, parent: state, taskIndex: this.taskIndex, choiceIndex })
    this.count("frontierInterfaceStoredStateCount")
    this.counters.frontierInterfaceMaxStateWidth = Math.max(this.counters.frontierInterfaceMaxStateWidth ?? 0, this.next.size)
    const affected = masks.slice(this.taskIndex + 1).filter((mask, offset) => mask !== this.fullMasks[this.taskIndex + 1 + offset]).length
    this.counters.frontierInterfaceMaxAffectedFutureTaskCount = Math.max(this.counters.frontierInterfaceMaxAffectedFutureTaskCount ?? 0, affected)
    this.progress = Math.min(0.99, (this.taskIndex + this.stateCursor / Math.max(1, this.current.length)) / this.tasks.length)
  }

  override tryFinalAcceptance(): void {
    if (this.solved || this.failed) return
    this.count("frontierInterfaceBudgetExhaustionCount")
    // No approximate state trimming is permitted. A cap is unknown; only
    // exact future-equivalent histories are merged while search continues.
  }
}
