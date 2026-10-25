import { EventTileSearchKernel, type EventTileSearchInputs } from "../HighDensitySolver/EventTileSearchKernel"
import { HighDensitySolverA13WithDrcValidation } from "./HighDensitySolverA13WithDrcValidation"

type ValidatedParams = ConstructorParameters<typeof HighDensitySolverA13WithDrcValidation>[0]
type EventParams = ValidatedParams & {
  eventDiagnostics?: Record<string, number>
}
type FrozenSearchKernel = {
  begin: (inputs: EventTileSearchInputs, start: number, goal: number, present: number) => void
  run: (steps: number, budget: number) => { status: number; expansions: number }
  copyParents: (target: Int32Array) => void
}

/**
 * Instance adapter for the pinned c6812ce A13 router. Geometry rasterization,
 * negotiation, terminal restoration and final physical DRC stay with that
 * router. Only its frozen additive search is replaced. Event contraction can
 * change A* ties and physical route selection. Production uses weighted A*, so
 * its achieved cost and negotiation outcome can also change; shortest-cost
 * equivalence is a representation claim, tested with zero heuristic. This does
 * not claim identical output or continuous/self-via-history completeness. A rejected physical route
 * remains rejected by the original validator, never accepted as a fallback.
 * A query selects native search before any path search if its remaining budget
 * cannot reserve preprocessing, or its compiled graph retains over 75% of the
 * dense states. A dense profile suspends event search for later node queries.
 * Profile work is charged before native delegation. Native search retains its
 * original expansion accounting; event search charges all kernel work units.
 */
export class HighDensitySolverA13EventTiles extends HighDensitySolverA13WithDrcValidation {
  eventKernel: EventTileSearchKernel | null = null
  readonly selectionDiagnostics = {
    nativeBudgetQueries: 0,
    nativeDensityQueries: 0,
    nativeSearchExpansions: 0,
  }
  private readonly aggregate?: Record<string, number>
  private readonly published: Record<string, number> = {}

  constructor(params: EventParams) {
    const { eventDiagnostics, ...validationParams } = params
    super(validationParams)
    this.aggregate = eventDiagnostics
    this.stats.eventSearchInstances = 1
    if (this.aggregate) {
      this.aggregate.eventSearchInstances = (this.aggregate.eventSearchInstances ?? 0) + 1
    }
  }

  override getSolverName(): string {
    return "HighDensitySolverA13EventTiles"
  }

  override _setup(): void {
    super._setup()
    const layers: unknown = Reflect.get(this, "layers")
    const pitchX: unknown = Reflect.get(this, "pitchX")
    const pitchY: unknown = Reflect.get(this, "pitchY")
    const plane: unknown = Reflect.get(this, "plane")
    const original: unknown = Reflect.get(this, "searchKernel")
    if (
      !Array.isArray(layers) || layers.length === 0 ||
      !layers.every((layer) => Number.isSafeInteger(layer) && layer >= 0) ||
      typeof pitchX !== "number" || typeof pitchY !== "number" ||
      plane !== this.cols * this.rows ||
      !original || typeof original !== "object" ||
      typeof Reflect.get(original, "begin") !== "function" ||
      typeof Reflect.get(original, "run") !== "function" ||
      typeof Reflect.get(original, "copyParents") !== "function"
    )
      throw new Error("Unsupported pinned A13 layout for event search")
    const states = this.cols * this.rows * layers.length
    for (const [name, Type, length] of [
      ["traceCost", Uint16Array, states],
      ["fixed", Uint8Array, states],
      ["history", Float64Array, states],
      ["heuristicCost", Float64Array, states],
      ["parent", Int32Array, states],
      ["viaCost", Uint16Array, plane],
      ["fixedVia", Uint8Array, plane],
      ["viaHistory", Float64Array, plane],
      ["viaAllowed", Uint8Array, plane],
    ] as const) {
      const value: unknown = Reflect.get(this, name)
      if (!(value instanceof Type) || value.length !== length)
        throw new Error(`Unsupported pinned A13 ${name} layout for event search`)
    }
    const native = original as FrozenSearchKernel
    const event = new EventTileSearchKernel(this.cols, this.rows, layers.length, pitchX, pitchY, 0.75)
    this.eventKernel = event
    const reserve = 2 * states + this.cols + this.rows + 1024
    let selected: FrozenSearchKernel | undefined
    let pending: [EventTileSearchInputs, number, number, number] | undefined
    let densitySuspended = false
    const runNative = (steps: number, budget: number): { status: number; expansions: number } => {
      const result = native.run(steps, budget)
      this.selectionDiagnostics.nativeSearchExpansions += result.expansions
      // A13 consumes this unchanged native count. Preflight work, if any,
      // is added by the dispatcher in the call that selected this strategy.
      return result
    }
    const dispatcher: FrozenSearchKernel = {
      begin: (inputs, start, goal, present): void => {
        pending = [inputs, start, goal, present]
        const remaining = (this.props.maxSearchIterations ?? 50_000_000) - this.routingIterations
        if (densitySuspended || remaining < reserve) {
          if (densitySuspended) this.selectionDiagnostics.nativeDensityQueries++
          else this.selectionDiagnostics.nativeBudgetQueries++
          selected = native
        } else selected = event
        selected.begin(...pending)
      },
      run: (steps, budget): { status: number; expansions: number } => {
        if (!selected || !pending) throw new Error("A13 event dispatcher must begin before search")
        if (selected === native) return runNative(steps, budget)
        const profile = event.run(steps, budget)
        if (profile.status !== 4) return profile
        densitySuspended = true
        this.selectionDiagnostics.nativeDensityQueries++
        selected = native
        native.begin(...pending)
        const remainingSteps = steps - profile.expansions
        if (remainingSteps === 0) return { status: 0, expansions: profile.expansions }
        const result = runNative(remainingSteps, budget - profile.expansions)
        return { status: result.status, expansions: profile.expansions + result.expansions }
      },
      copyParents: (target): void => {
        if (!selected) throw new Error("A13 event dispatcher has no selected query kernel")
        // Only the strategy selected for this immutable query publishes its
        // own parents. A declined compiler has no path to publish.
        selected.copyParents(target)
      },
    }
    if (!Reflect.set(this, "searchKernel", dispatcher))
      throw new Error("Could not install the owned A13 event-search kernel")
    this.stats.eventSearchKernelInstalled = 1
  }

  override _step(): void {
    super._step()
    const kernel = this.eventKernel
    if (!kernel) throw new Error("Event kernel must be installed before A13 steps")
    this.stats.eventSearchKernelInstalled = 1
    // A13 replaces stats when a negotiation round finishes. Publish after it,
    // and transfer only new work to the owning per-node benchmark ledger.
    for (const [name, value] of Object.entries({ ...kernel.diagnostics, ...this.selectionDiagnostics })) {
      const key = `eventSearch${name[0]!.toUpperCase()}${name.slice(1)}`
      this.stats[key] = value
      if (this.aggregate) {
        const delta = value - (this.published[key] ?? 0)
        if (delta < 0) throw new Error("Event search diagnostics moved backwards")
        this.aggregate[key] = (this.aggregate[key] ?? 0) + delta
      }
      this.published[key] = value
    }
  }
}
