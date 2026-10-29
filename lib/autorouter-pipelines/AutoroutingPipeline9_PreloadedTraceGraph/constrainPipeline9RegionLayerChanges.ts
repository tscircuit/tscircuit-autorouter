import type { HyperGraphHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"
import { getPipeline9PadPointDistance } from "./getPipeline9PadPointDistance"
import { getPipeline9PhysicalBoardObstaclesInBounds } from "./getPipeline9PhysicalBoardObstaclesInBounds"
import {
  getPipeline9PhysicalObstacleOwner,
  type Pipeline9PhysicalOwnership,
} from "./getPipeline9PhysicalOwnership"

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
type Pad = { obstacle: Obstacle; owner: string }
type Coverage = { covered: boolean; usedOwners: Set<string> }
const COVERAGE_CELL_BUDGET = 128
const COVERAGE_MAX_DEPTH = 8

/** A positive certificate uses only convex copper pieces strictly covering every cell. */
const coverViaCenterRegion = (
  bounds: Bounds,
  pads: Pad[],
  forbiddenDistance: number,
  waivedOwner?: string,
): Coverage => {
  const foreign = waivedOwner === undefined ? pads : pads.filter((pad) => pad.owner !== waivedOwner)
  const pending = [{ ...bounds, depth: 0 }]
  const usedOwners = new Set<string>()
  let cells = 0
  while (pending.length > 0) {
    if (++cells > COVERAGE_CELL_BUDGET) return { covered: false, usedOwners }
    const cell = pending.pop()!
    const corners = [
      { x: cell.minX, y: cell.minY }, { x: cell.minX, y: cell.maxY },
      { x: cell.maxX, y: cell.minY }, { x: cell.maxX, y: cell.maxY },
    ]
    const covering = foreign.find((pad) => corners.every((corner) =>
      getPipeline9PadPointDistance(corner, pad.obstacle, "inner") < forbiddenDistance))
    if (covering) {
      usedOwners.add(covering.owner)
      continue
    }
    const x = (cell.minX + cell.maxX) / 2
    const y = (cell.minY + cell.maxY) / 2
    if (cell.depth >= COVERAGE_MAX_DEPTH || !foreign.some((pad) =>
      getPipeline9PadPointDistance({ x, y }, pad.obstacle, "inner") < forbiddenDistance)) {
      return { covered: false, usedOwners }
    }
    const depth = cell.depth + 1
    const width = cell.maxX - cell.minX
    const height = cell.maxY - cell.minY
    // When one bisection would still leave a >2:1 rectangle, subdividing
    // the short axis wastes the bounded proof on unnecessarily thin cells.
    // Near-square cells keep the existing quadrant resolution and depth.
    if (width > 4 * height) {
      pending.push({ ...cell, maxX: x, depth }, { ...cell, minX: x, depth })
    } else if (height > 4 * width) {
      pending.push({ ...cell, maxY: y, depth }, { ...cell, minY: y, depth })
    } else {
      pending.push(
        { minX: cell.minX, minY: cell.minY, maxX: x, maxY: y, depth },
        { minX: x, minY: cell.minY, maxX: cell.maxX, maxY: y, depth },
        { minX: cell.minX, minY: y, maxX: x, maxY: cell.maxY, depth },
        { minX: x, minY: y, maxX: cell.maxX, maxY: cell.maxY, depth },
      )
    }
  }
  return { covered: true, usedOwners }
}

/** Certify owner-specific through-via exclusions without changing planar travel or mesh geometry. */
export const constrainPipeline9RegionLayerChanges = ({
  graph,
  originalSrj,
  physicalOwnership,
  routingNetIds,
  viaDiameter,
}: {
  graph: HyperGraphHg
  originalSrj: SimpleRouteJson
  physicalOwnership: Pipeline9PhysicalOwnership
  routingNetIds: readonly string[]
  viaDiameter: number
}): number => {
  // Multilayer P9 keeps the physical rectangle through uniform distribution.
  // The two-layer legacy distributor may expand it around off-edge ports.
  if (originalSrj.allowBlindAndBuriedVias || originalSrj.layerCount <= 2) return 0
  if (!Number.isFinite(viaDiameter) || viaDiameter <= 0) {
    throw new Error("Via-center certification requires the original manufactured diameter")
  }
  const declaredGap = originalSrj.minViaEdgeToPadEdgeClearance ?? 0.1
  if (!Number.isFinite(declaredGap) || declaredGap < 0) {
    throw new Error("Via-center certification requires the original pad clearance")
  }
  // At or below the checker's tolerance, overlap alone is not a proven
  // clearance violation. Leave these uncommon regions without a hard cut.
  if (declaredGap <= 0.005) return 0
  // Hard exclusions require an actual violation after the unchanged checker tolerance.
  const forbiddenDistance = viaDiameter / 2 + declaredGap - 0.005 - 1e-9
  const knownRoutingNets = new Set(routingNetIds)
  const netsByOwner = new Map<string, string[]>()
  const unknownOwnerNets: string[] = []
  for (const netId of knownRoutingNets) {
    const owner = physicalOwnership.routingNetOwners[netId]
    if (owner === undefined || owner === null) unknownOwnerNets.push(netId)
    else netsByOwner.set(owner, [...(netsByOwner.get(owner) ?? []), netId])
  }
  let constrainedCount = 0
  for (const region of graph.regions) {
    const bounds = {
      minX: region.d.center.x - region.d.width / 2,
      maxX: region.d.center.x + region.d.width / 2,
      minY: region.d.center.y - region.d.height / 2,
      maxY: region.d.center.y + region.d.height / 2,
    }
    const nearby = getPipeline9PhysicalBoardObstaclesInBounds(originalSrj.obstacles, {
      minX: bounds.minX - forbiddenDistance, minY: bounds.minY - forbiddenDistance,
      maxX: bounds.maxX + forbiddenDistance, maxY: bounds.maxY + forbiddenDistance,
    })
    const pads: Pad[] = []
    for (const obstacle of nearby) {
      const layers = obstacle.__zLayers ?? obstacle.zLayers ?? obstacle.layers
      // Holes, pour bounds and synthetic keepouts are not filled pad copper.
      if (obstacle.isNonPlatedHole || obstacle.isCopperPour ||
        obstacle.isFanoutSourceKeepout || new Set<string | number>(layers).size !== 1) continue
      const owner = getPipeline9PhysicalObstacleOwner(physicalOwnership, obstacle)
      if (owner === undefined) continue
      pads.push({ obstacle, owner })
    }
    const generic = coverViaCenterRegion(bounds, pads, forbiddenDistance)
    if (!generic.covered) continue
    const allowedNets = new Set(unknownOwnerNets)
    for (const owner of generic.usedOwners) {
      // Owners absent from this positive cover cannot invalidate it by waiving their pads.
      if (coverViaCenterRegion(bounds, pads, forbiddenDistance, owner).covered) continue
      for (const netId of netsByOwner.get(owner) ?? []) allowedNets.add(netId)
    }
    if (allowedNets.size === knownRoutingNets.size) continue
    region.d = { ...region.d, layerChangeAllowedNetIds: [...allowedNets].sort() }
    constrainedCount++
  }
  return constrainedCount
}
