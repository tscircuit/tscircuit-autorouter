import type { TinyHyperGraphSolver, TinyHyperGraphSectionPipelineInput } from "tiny-hypergraph/lib/index"
import type { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"
import type { WasmTinyHypergraphPipeline } from "./WasmTinyHypergraphPipeline"

export type TinyHypergraphSolverView = Pick<
  TinyHyperGraphSolver,
  "topology" | "problem" | "iterations" | "stats" | "solved" | "failed"
> & { state: Pick<TinyHyperGraphSolver["state"], "regionSegments"> }

export type LoadedTinyHypergraph = ReturnType<typeof loadSerializedHyperGraph>

export type TinyHypergraphPolicyCounts = {
  duplicatePortPenaltyCount: number
  metadataPortPenaltyCount: number
  crampedPortPenaltyCount: number
  preloadedPortCount: number
  preloadedFixedSegmentCount: number
  crampedPortTraversalPenalty: number
}

export type TinyHypergraphRoutingInput = Pick<
  TinyHyperGraphSectionPipelineInput, "serializedHyperGraph" | "solveGraphOptions" | "sectionSolverOptions"
>

export type TinyHypergraphBackend = {
  createPipeline: (
    input: TinyHypergraphRoutingInput,
    selectiveRerip: boolean,
    configure: (loaded: LoadedTinyHypergraph) => TinyHypergraphPolicyCounts,
  ) => WasmTinyHypergraphPipeline
}

let backend: TinyHypergraphBackend | undefined

export function registerTinyHypergraphBackend(value: TinyHypergraphBackend): void {
  if (backend && backend !== value) {
    throw new Error("A tiny-hypergraph backend is already registered")
  }
  backend = value
}

export function getTinyHypergraphBackend(): TinyHypergraphBackend | undefined {
  return backend
}
