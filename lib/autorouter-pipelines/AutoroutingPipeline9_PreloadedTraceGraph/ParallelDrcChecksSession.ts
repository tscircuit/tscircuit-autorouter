import { SolverRuntime, type SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { serialize, deserialize } from "node:v8"
import { getDrcErrorsForPartition, type DrcCheckExecutor } from "lib/testing/getDrcErrors"
import { BaseSolver } from "lib/solvers/BaseSolver"

type QueryInput = {
  state: Int32Array
  input: Uint8Array
  output: Uint8Array
  partition: number
  partitions: number
}

export class ParallelDrcChecksSolver extends BaseSolver {
  static readonly solverName = "ParallelDrcChecksSolver"

  constructor(private readonly input: QueryInput) {
    super()
  }

  override _step(): void {
    const { state, input, output, partition, partitions } = this.input
    try {
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
        const frame = deserialize(new Uint8Array(input.subarray(0, state[2])))
        const errors = getDrcErrorsForPartition(
          frame.circuitJson,
          frame.options,
          new ConnectivityMap(frame.netMap),
          partition,
        )
        const result = serialize(errors)
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

SolverRuntime.registerSolver(ParallelDrcChecksSolver)

export class ParallelDrcChecksSession {
  private channels?: Array<{ state: Int32Array; output: Uint8Array }>
  private inputBuffer?: Uint8Array
  private pending: Promise<unknown>[] = []

  async enable(runtime: SolverRuntimeExecutor): Promise<void> {
    if (this.channels) throw new Error("Parallel DRC session already active")
    this.inputBuffer = new Uint8Array(new SharedArrayBuffer(32 * 1024 * 1024))
    this.channels = Array.from({ length: 4 }, () => ({
      state: new Int32Array(new SharedArrayBuffer(16)),
      output: new Uint8Array(new SharedArrayBuffer(16 * 1024 * 1024)),
    }))
    this.pending = this.channels.map(({ state, output }, partition) =>
      runtime.executeAsync(ParallelDrcChecksSolver, {
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

  readonly evaluate: DrcCheckExecutor = (circuitJson, options, connMap) => {
    if (!this.channels) throw new Error("Parallel DRC session is not active")
    const encoded = serialize({ circuitJson, options, netMap: connMap.netMap })
    if (encoded.length > this.inputBuffer!.length) throw new Error("Parallel DRC geometry exceeds shared buffer")
    this.inputBuffer!.set(encoded)
    for (const { state } of this.channels) {
      state[2] = encoded.length
      Atomics.store(state, 0, 1)
      Atomics.notify(state, 0)
    }
    const errors: ReturnType<DrcCheckExecutor> = []
    for (const { state, output } of this.channels) {
      while (Atomics.load(state, 0) === 1) {
        if (Atomics.wait(state, 0, 1, 30_000) === "timed-out") {
          throw new Error("Parallel DRC query timed out")
        }
      }
      if (Atomics.load(state, 0) !== 2) throw new Error("Parallel DRC worker query failed")
      const result = deserialize(new Uint8Array(output.subarray(0, state[3])))
      errors.push(...result)
    }
    return errors
  }
}
