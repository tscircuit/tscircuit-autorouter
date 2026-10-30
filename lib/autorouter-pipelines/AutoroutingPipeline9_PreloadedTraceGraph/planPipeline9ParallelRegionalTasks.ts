import { extractRepairRegion, type Bounds } from "@tscircuit/repair04"
import { isViaPadDrcError } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getDrcErrorTraceIds } from "lib/utils/getDrcErrorTraceIds"
import type { Pipeline9ParallelRegionalTaskInput } from "./Pipeline9ParallelRegionalTaskSolver"

export type Pipeline9ParallelRegionalPlanInput = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  errors: Array<Record<string, unknown>>
  maxTasks: number
  maxPathSearchCalls: number
  maxPathSearchNodes: number
  maxPathSearchNodesPerCall: number
  maxPathSearchCallsPerRegion?: number
  regionSize?: number
  pathHeuristicWeight?: number
  pathGridSizeScale?: number
  searchDirectionCount?: 1 | 2
  maxLogicalIterations: number
  viaHoleDiameter?: number
}

type PlannedRegion = {
  bounds: Bounds
  traceIds: Set<string>
}

/** Split distant DRC centers into bounded jobs against one board snapshot. */
export function planPipeline9ParallelRegionalTasks(
  input: Pipeline9ParallelRegionalPlanInput,
): Pipeline9ParallelRegionalTaskInput[] {
  const taskLimit = Math.min(
    input.maxTasks,
    input.maxPathSearchCalls,
    Math.floor(input.maxPathSearchNodes / 2),
    input.maxLogicalIterations,
  )
  if (taskLimit < 1) return []
  const regions: PlannedRegion[] = []
  const obstacleCenters = new Map<string, { x: number; y: number }>()
  for (const obstacle of input.srj.obstacles) {
    for (const id of [
      obstacle.obstacleId,
      obstacle.circuitJsonMetadata?.pcb_smtpad_id,
      obstacle.circuitJsonMetadata?.pcb_plated_hole_id,
      obstacle.connectedTo[0],
    ]) {
      if (typeof id === "string") obstacleCenters.set(id, obstacle.center)
    }
  }
  const nonViaErrors = input.errors.filter((error) => !isViaPadDrcError(error))
  const orderedErrors = [...nonViaErrors, ...input.errors.filter(isViaPadDrcError)]
  for (const error of orderedErrors) {
    const pairPrefix = `overlap_${error.pcb_trace_id}_`
    const padId = typeof error.pcb_pad_id === "string"
      ? error.pcb_pad_id
      : typeof error.pcb_trace_error_id === "string" &&
          error.pcb_trace_error_id.startsWith(pairPrefix)
        ? error.pcb_trace_error_id.slice(pairPrefix.length)
        : undefined
    const center = (padId ? obstacleCenters.get(padId) : undefined) ?? error.center ?? error.pcb_center
    if (
      !center || typeof center !== "object" ||
      !("x" in center) || !("y" in center) ||
      typeof center.x !== "number" || typeof center.y !== "number" ||
      !Number.isFinite(center.x) || !Number.isFinite(center.y)
    ) continue
    const traceIds = getDrcErrorTraceIds(error)
    if (traceIds.length === 0) continue
    const size = input.regionSize ?? 16
    const bounds = {
      minX: center.x - size / 2,
      maxX: center.x + size / 2,
      minY: center.y - size / 2,
      maxY: center.y + size / 2,
    }
    const overlapping = regions.find((region) =>
      bounds.minX <= region.bounds.maxX && bounds.maxX >= region.bounds.minX &&
      bounds.minY <= region.bounds.maxY && bounds.maxY >= region.bounds.minY,
    )
    if (overlapping) {
      for (const id of traceIds) overlapping.traceIds.add(id)
    } else if (regions.length < taskLimit) {
      regions.push({ bounds, traceIds: new Set(traceIds) })
    }
  }
  const srj = { ...createSrjWithBoardValidObstacleLayers(input.srj), traces: undefined }
  const extracted = regions.flatMap(({ bounds, traceIds }) => {
    const region = extractRepairRegion({ srj, routes: input.routes, bounds })
    const dirtyRouteIndices = region.routes.flatMap((route, index): number[] =>
      [...traceIds].some((id) => id === route.connectionName || id.startsWith(`${route.connectionName}_`))
        ? [index]
        : [],
    )
    return dirtyRouteIndices.length > 0 ? [{ region, dirtyRouteIndices }] : []
  })
  if (extracted.length === 0) return []
  const callsPerTask = Math.min(
    Math.floor(input.maxPathSearchCalls / extracted.length),
    input.maxPathSearchCallsPerRegion ?? input.maxPathSearchCalls,
  )
  const nodesPerTask = Math.floor(input.maxPathSearchNodes / extracted.length)
  return extracted.map(({ region, dirtyRouteIndices }): Pipeline9ParallelRegionalTaskInput => ({
    region,
    dirtyRouteIndices,
    maxPathSearchCalls: callsPerTask,
    maxPathSearchNodes: nodesPerTask,
    maxPathSearchNodesPerCall: Math.min(
      input.maxPathSearchNodesPerCall,
      (input.searchDirectionCount ?? 1) === 2
        ? Math.max(1, Math.floor(nodesPerTask / 2))
        : nodesPerTask,
    ),
    pathHeuristicWeight: input.pathHeuristicWeight,
    pathGridSizeScale: input.pathGridSizeScale,
    searchDirectionCount: input.searchDirectionCount ?? 1,
    maxLogicalIterations: Math.floor(input.maxLogicalIterations / extracted.length),
    traceClearance: RELAXED_DRC_OPTIONS.traceClearance!,
    viaClearance: srj.minPadEdgeToPadEdgeClearance ?? RELAXED_DRC_OPTIONS.viaClearance!,
    viaHoleDiameter: input.viaHoleDiameter,
  }))
}
