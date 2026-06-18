import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  TINY_SECTION_SOLVER_BASE_OPTIONS,
  TINY_SOLVE_GRAPH_BASE_OPTIONS,
  type TinyHyperGraphSectionPipelineInput,
  type TinyHyperGraphSectionSolverOptions,
  type TinyHyperGraphSolverOptions,
} from "./types"

export const getTinyHyperGraphPipelineInput = (
  serializedHyperGraph: SerializedHyperGraph,
  effort: number,
  minViaPadDiameter?: number,
): TinyHyperGraphSectionPipelineInput => ({
  serializedHyperGraph,
  createSectionMask: ({ topology }) => new Int8Array(topology.portCount),
  solveGraphOptions: getTinyHyperGraphSolveGraphOptions(
    effort,
    minViaPadDiameter,
  ),
  sectionSolverOptions: getTinyHyperGraphSectionSolverOptions(
    effort,
    minViaPadDiameter,
  ),
})

export const getTinyHyperGraphPipelineMaxIterations = (
  inputProblem: TinyHyperGraphSectionPipelineInput,
): number =>
  (inputProblem.solveGraphOptions?.MAX_ITERATIONS ?? 1_000_000) +
  (inputProblem.sectionSolverOptions?.MAX_ITERATIONS ?? 1_000_000) +
  1_000_000

const getOptionalMinViaPadDiameter = (
  minViaPadDiameter?: number,
): Pick<TinyHyperGraphSolverOptions, "minViaPadDiameter"> | Record<never, never> =>
  Number.isFinite(minViaPadDiameter) ? { minViaPadDiameter } : {}

export const getTinyHyperGraphSectionSolverOptions = (
  effort: number,
  minViaPadDiameter?: number,
): TinyHyperGraphSectionSolverOptions => {
  const effortScale = Math.max(effort, 1e-2)

  return {
    ...TINY_SECTION_SOLVER_BASE_OPTIONS,
    ...getOptionalMinViaPadDiameter(minViaPadDiameter),
    USE_SPARSE_CANDIDATE_STORAGE: true,
    RIP_THRESHOLD_RAMP_ATTEMPTS: Math.ceil(16 * effortScale),
    MAX_ITERATIONS: Math.ceil(1_000_000 * effortScale),
  }
}

export const getTinyHyperGraphSolveGraphOptions = (
  effort: number,
  minViaPadDiameter?: number,
): TinyHyperGraphSolverOptions => {
  const effortScale = Math.max(effort, 1e-2)

  return {
    ...TINY_SOLVE_GRAPH_BASE_OPTIONS,
    ...getOptionalMinViaPadDiameter(minViaPadDiameter),
    USE_SPARSE_CANDIDATE_STORAGE: true,
    RIP_THRESHOLD_RAMP_ATTEMPTS: Math.ceil(10 * effortScale),
    MAX_ITERATIONS: Math.ceil(2_000_000 * effortScale),
  }
}
