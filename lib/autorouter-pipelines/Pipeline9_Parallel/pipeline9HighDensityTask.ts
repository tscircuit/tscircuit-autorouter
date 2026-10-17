import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "../../types/high-density-types"

export type HighDensityTaskShared = Omit<Pipeline9HighDensitySolverParams, "connMap" | "nodePortPoints"> & {
  connectivityNetMap: ConnectivityMap["netMap"]
}
export type HighDensityTaskOutput = {
  routes: HighDensityIntraNodeRoute[]
  stats: Record<string, number>
  iterations: number
  nodeCount: number
}

/** Each job owns all mutable algorithm state and retains Pipeline9's recovery logic. */
export function runPipeline9HighDensityTask(nodes: NodeWithPortPoints[], { shared }: { shared: HighDensityTaskShared }): HighDensityTaskOutput {
  const solver = new Pipeline9HighDensitySolver({
    ...shared,
    connMap: new ConnectivityMap(shared.connectivityNetMap),
    nodePortPoints: nodes,
  })
  solver.solve()
  if (solver.failed) throw new Error(solver.error ?? "High-density node failed")
  return { routes: solver.routes, stats: solver.stats, iterations: solver.iterations, nodeCount: nodes.length }
}
