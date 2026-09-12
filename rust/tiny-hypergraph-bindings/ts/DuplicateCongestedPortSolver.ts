import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { duplicateCongestedPorts } from "../pkg/tiny_hypergraph_bindings.js"
import { assertTinyHypergraphBindingsInitialized } from "./loadTinyHypergraphBindings.js"
import type { TinyHyperGraphSolverOptions } from "./types.js"

export type DuplicateCongestedPortSolverReport = {
  portUseCounts: Record<string, number>
  duplicatedPorts: Array<{
    sourcePortId: string
    duplicatePortIds: string[]
    useCount: number
  }>
}

type DuplicatePortResult = {
  solved: boolean
  failed: boolean
  error: string | null
  report: DuplicateCongestedPortSolverReport
  output?: SerializedHyperGraph
}

export class DuplicateCongestedPortSolver {
  solved = false
  failed = false
  error: string | null = null
  report: DuplicateCongestedPortSolverReport = { portUseCounts: {}, duplicatedPorts: [] }
  private output: SerializedHyperGraph | undefined

  constructor(
    private readonly graph: SerializedHyperGraph,
    private readonly options: {
      duplicatePortProximity?: number
      useSerializedPortPenalties?: boolean
      routeSolveOptions?: TinyHyperGraphSolverOptions
    } = {},
  ) {}

  solve(): void {
    assertTinyHypergraphBindingsInitialized()
    const result = duplicateCongestedPorts(this.graph, this.options) as DuplicatePortResult
    this.solved = result.solved
    this.failed = result.failed
    this.error = result.error ?? null
    this.report = result.report
    this.output = result.output
  }

  getOutput(): SerializedHyperGraph {
    if (this.failed || !this.output) {
      throw new Error("DuplicateCongestedPortSolver does not have a repaired topology output")
    }
    return this.output
  }
}
