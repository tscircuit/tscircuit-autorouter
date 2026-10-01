import { createHash } from "node:crypto"
import type { SimpleRouteJson } from "../../lib/types"
import type { BenchmarkTask } from "./benchmark-types"
import type {
  PostRoutingOptimizationInput,
  PostRoutingOptimizationOptions,
  PostRoutingOptimizationResult,
} from "../../lib/solvers/PostRoutingOptimization/optimizePostRouting"
import { preparePostRoutingWholeNetInput } from "../../lib/solvers/PostRoutingOptimization/preparePostRoutingWholeNetInput"

/** Explicit benchmark-only opt-in on this comparison branch. Product defaults
 * remain unchanged. The paired workflow runs the same P9 command on its base:
 * main has no profile; the A+B branch's base explicitly selects A. */
export const PIPELINE9_POST_ROUTING_BENCHMARK_ARM: "A" | "B" | "A+B" = "A+B"

/** Limit this comparison profile to the explicitly requested public datasets. */
export function isPipeline9PostRoutingBenchmarkTask(
  task: BenchmarkTask,
): boolean {
  return (
    !task.networkedCachePass &&
    (task.datasetName === "dataset01" || task.datasetName === "srj18") &&
    (task.solverConstructorName ?? task.solverName) ===
      "AutoroutingPipelineSolver9_PreloadedTraceGraph"
  )
}

export function getPipeline9PostRoutingBenchmarkOptions(srj: SimpleRouteJson) {
  const prepared = preparePostRoutingWholeNetInput(
    srj,
    srj.traces ?? [],
    srj.traces ?? [],
    [],
  )
  const fixedOwners = new Set(prepared.traceOwners.values())
  const mutable = prepared.srj.connections.filter(
    (c) => !fixedOwners.has(c.name),
  )
  const selected = (
    mutable.length ? mutable : prepared.srj.connections
  ).toSorted((a, b) => b.pointsToConnect.length - a.pointsToConnect.length)[0]
  if (!selected)
    throw new Error("Post-routing benchmark requires a declared net")
  const arm = PIPELINE9_POST_ROUTING_BENCHMARK_ARM as "A" | "B" | "A+B"
  const phase: PostRoutingOptimizationOptions = {
    enabled: true,
    nets: [{ net: selected.name, maxNewVias: 2, maxNewViasPerBranch: 1 }],
    objective: {
      priorities: ["viaSites", "copperLength", "bends"],
      maxCopperLengthIncrease: 0,
      maxBendIncrease: 0,
      maxChangedNets: 1,
    },
    search: {
      gridStep: 0.5,
      viaCost: 3,
      bendCost: 0.05,
      maxExpansions: arm === "A+B" ? 150_000 : 300_000,
      maxMilliseconds: arm === "A+B" ? 2500 : 5000,
    },
  }
  return {
    // Each benchmark sample has isolated routing state.
    cacheProvider: null,
    ...(arm.includes("A")
      ? { dynamicNetTreeRouting: structuredClone(phase) }
      : {}),
    ...(arm.includes("B")
      ? { postRoutingOptimization: structuredClone(phase) }
      : {}),
  }
}

export function summarizePostRoutingBenchmark(
  result: PostRoutingOptimizationResult,
  params?: [PostRoutingOptimizationInput, PostRoutingOptimizationOptions],
) {
  const { traces, changes, ...summary } = result
  const hash = (traces: unknown) =>
    createHash("sha256").update(JSON.stringify(traces)).digest("hex")
  const { validate, ...actualOptions } =
    params?.[1] ?? ({} as PostRoutingOptimizationOptions)
  return {
    ...summary,
    beforeSha256: params ? hash(params[0].traces) : undefined,
    afterSha256: hash(result.traces),
    actualOptions,
  }
}
