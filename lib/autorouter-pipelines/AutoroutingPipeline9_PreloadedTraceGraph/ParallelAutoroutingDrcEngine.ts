import { SolverRuntime, type SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { serialize, deserialize } from "node:v8"
import {
  AutoroutingDrcEngine,
  type AutoroutingDrcError,
  type DrcQueryGeometry,
} from "high-density-repair03/lib/drc/AutoroutingDrcEngine"
import { BaseSolver } from "lib/solvers/BaseSolver"

type EngineOptions = NonNullable<ConstructorParameters<typeof AutoroutingDrcEngine>[1]>
type EngineInput = ConstructorParameters<typeof AutoroutingDrcEngine>[0]
type QueryInput = {
  srj: EngineInput
  options: Omit<EngineOptions, "connMap">
  connectivityNetMap?: Record<string, string[]>
  state: Int32Array
  input: Uint8Array
  output: Uint8Array
  partition: number
  partitions: number
}

export class ParallelDrcQuerySolver extends BaseSolver {
  static readonly solverName = "ParallelDrcQuerySolver"

  constructor(private readonly input: QueryInput) {
    super()
  }

  override _step(): void {
    const { state, input, output, partition, partitions } = this.input
    try {
      const engine = new AutoroutingDrcEngine(this.input.srj, {
        ...this.input.options,
        connMap: this.input.connectivityNetMap
          ? new ConnectivityMap(this.input.connectivityNetMap)
          : undefined,
      })
      Atomics.store(state, 1, 1)
      Atomics.notify(state, 1)
      while (true) {
        let command = Atomics.load(state, 0)
        while (command === 0 || command === 2) {
          Atomics.wait(state, 0, command)
          command = Atomics.load(state, 0)
        }
        if (command === -1) break
        if (command !== 1) throw new Error("Invalid parallel DRC command")
        const geometry = deserialize(Buffer.from(input.subarray(0, state[2]))) as DrcQueryGeometry
        engine.lastRunStats.exactCheckCount = 0
        engine.lastRunStats.broadPhaseCandidateCount = 0
        const errors = engine.evaluateTraceQueries(
          geometry,
          Math.floor(geometry.segments.length * partition / partitions),
          Math.floor(geometry.segments.length * (partition + 1) / partitions),
        )
        const result = serialize({
          errors,
          exactCheckCount: engine.lastRunStats.exactCheckCount,
          broadPhaseCandidateCount: engine.lastRunStats.broadPhaseCandidateCount,
        })
        if (result.length > output.length) throw new Error("Parallel DRC response exceeds shared buffer")
        output.set(result)
        state[3] = result.length
        Atomics.store(state, 0, 2)
        Atomics.notify(state, 0)
      }
      this.solved = true
    } catch (error) {
      const result = serialize({ error: String(error) })
      output.set(result)
      state[3] = result.length
      Atomics.store(state, 1, 1)
      Atomics.store(state, 0, 3)
      Atomics.notify(state, 0)
      throw error
    }
  }

  getOutput(): boolean {
    return this.solved
  }
}

SolverRuntime.registerSolver(ParallelDrcQuerySolver)

export class ParallelAutoroutingDrcEngine extends AutoroutingDrcEngine {
  private channels?: Array<{ state: Int32Array; output: Uint8Array }>
  private inputBuffer?: Uint8Array
  private pending: Promise<unknown>[] = []

  constructor(
    private readonly inputSrj: EngineInput,
    private readonly inputOptions: EngineOptions,
  ) {
    super(inputSrj, inputOptions)
  }

  async enable(runtime: SolverRuntimeExecutor): Promise<void> {
    if (this.channels) throw new Error("Parallel DRC session already active")
    this.inputBuffer = new Uint8Array(new SharedArrayBuffer(32 * 1024 * 1024))
    this.channels = Array.from({ length: 4 }, () => ({
      state: new Int32Array(new SharedArrayBuffer(16)),
      output: new Uint8Array(new SharedArrayBuffer(16 * 1024 * 1024)),
    }))
    const { connMap, ...options } = this.inputOptions
    this.pending = this.channels.map(({ state, output }, partition) =>
      runtime.executeAsync(ParallelDrcQuerySolver, {
        srj: this.inputSrj,
        options,
        connectivityNetMap: connMap?.netMap,
        state,
        input: this.inputBuffer!,
        output,
        partition,
        partitions: 4,
      }).catch((error: unknown) => {
        Atomics.store(state, 0, 3)
        Atomics.store(state, 1, 1)
        Atomics.notify(state, 0)
        return { error }
      }),
    )
    const deadline = performance.now() + 30_000
    while (this.channels.some(({ state }) => Atomics.load(state, 1) === 0)) {
      if (performance.now() > deadline) throw new Error("Parallel DRC workers did not start")
      await new Promise<void>((resolve) => setTimeout(resolve, 1))
    }
    if (this.channels.some(({ state }) => Atomics.load(state, 0) === 3)) {
      throw new Error("Parallel DRC worker initialization failed")
    }
  }

  async close(): Promise<void> {
    if (!this.channels) return
    for (const { state } of this.channels) {
      Atomics.store(state, 0, -1)
      Atomics.notify(state, 0)
    }
    const outcomes = await Promise.all(this.pending)
    this.channels = undefined
    this.inputBuffer = undefined
    for (const outcome of outcomes) {
      if (typeof outcome === "object" && outcome !== null && "error" in outcome) {
        throw outcome.error
      }
    }
  }

  protected override collectTraceErrors(geometry: DrcQueryGeometry): AutoroutingDrcError[] {
    if (!this.channels) return super.collectTraceErrors(geometry)
    const encoded = serialize(geometry)
    if (encoded.length > this.inputBuffer!.length) throw new Error("Parallel DRC geometry exceeds shared buffer")
    this.inputBuffer!.set(encoded)
    for (const { state } of this.channels) {
      state[2] = encoded.length
      Atomics.store(state, 0, 1)
      Atomics.notify(state, 0)
    }
    const errors: AutoroutingDrcError[] = []
    for (const { state, output } of this.channels) {
      while (Atomics.load(state, 0) === 1) {
        if (Atomics.wait(state, 0, 1, 30_000) === "timed-out") {
          throw new Error("Parallel DRC query timed out")
        }
      }
      if (Atomics.load(state, 0) !== 2) throw new Error("Parallel DRC worker query failed")
      const result = deserialize(Buffer.from(output.subarray(0, state[3])))
      errors.push(...result.errors)
      this.lastRunStats.exactCheckCount += result.exactCheckCount
      this.lastRunStats.broadPhaseCandidateCount += result.broadPhaseCandidateCount
    }
    return errors
  }
}
