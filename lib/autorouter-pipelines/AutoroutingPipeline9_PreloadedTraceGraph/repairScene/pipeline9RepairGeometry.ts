/**
 * Adapted from @tscircuit/repair04 at 4273e9455084b7b35ebc860ebe4483b9d19692ea.
 * Copyright (c) 2025 tscircuit Inc. MIT license: ./LICENSE.
 * Native search policy, work budgets and physical checks are retained.
 */
import type { Bounds, ClearancePathInput } from "@tscircuit/repair04"
type HighDensityRoute = ClearancePathInput["routes"][number]
type SimpleRouteJson = ClearancePathInput["srj"]

type RepairRoutePoint = ClearancePathInput["start"]
type Point = { x: number; y: number }

export const REGION_EPSILON = 1e-8

export const isPointInBounds = (
  point: { x: number; y: number },
  bounds: Bounds,
  inset = 0,
): boolean => {
  return (
    point.x >= bounds.minX + inset - REGION_EPSILON &&
    point.x <= bounds.maxX - inset + REGION_EPSILON &&
    point.y >= bounds.minY + inset - REGION_EPSILON &&
    point.y <= bounds.maxY - inset + REGION_EPSILON
  )
}


/** Trace layers are electrical; a default drilled via occupies the whole board. */
export function getRepairCopperLayerSpan(
  srj: Pick<SimpleRouteJson, "layerCount"> & {
    allowBlindAndBuriedVias?: boolean
  },
  a: { z: number },
  b: { z: number },
): { minZ: number; maxZ: number } {
  const throughHole = a.z !== b.z && srj.allowBlindAndBuriedVias !== true
  return {
    minZ: throughHole ? 0 : Math.min(a.z, b.z),
    maxZ: throughHole ? srj.layerCount - 1 : Math.max(a.z, b.z),
  }
}


/** Keep fixed collar copper even when its layer transition is outside the crop. */
export function getRepairRouteVias({
  route,
  mutableBounds,
}: {
  route: HighDensityRoute
  mutableBounds: Bounds
}): HighDensityRoute["vias"] {
  const vias = route.vias
    .filter(
      (via) =>
        !isPointInBounds(via, mutableBounds, REGION_EPSILON * 4) &&
        route.route.some(
          (point) =>
            Math.abs(point.x - via.x) <= REGION_EPSILON &&
            Math.abs(point.y - via.y) <= REGION_EPSILON,
        ),
    )
    .map((via) => structuredClone(via))
  for (let index = 1; index < route.route.length; index++) {
    const start = route.route[index - 1]!
    const end = route.route[index]!
    if (start.z === end.z || start.toNextSegmentType === "through_obstacle")
      continue
    if (start.x !== end.x || start.y !== end.y) {
      throw new Error(
        "repair04: a layer transition must have coincident endpoints",
      )
    }
    if (!vias.some((via) => via.x === end.x && via.y === end.y)) {
      vias.push({ x: end.x, y: end.y })
    }
  }
  return vias
}


export const getNetRepresentatives = (
  srj: Pick<SimpleRouteJson, "connections" | "obstacles">,
  routes: readonly HighDensityRoute[],
): Map<string, string> => {
  const parents = new Map<string, string>()
  const find = (name: string): string => {
    const parent = parents.get(name)
    if (parent === undefined) {
      parents.set(name, name)
      return name
    }
    if (parent === name) return name
    const root = find(parent)
    parents.set(name, root)
    return root
  }
  const union = (names: Array<string | undefined>): void => {
    const present = names.filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    )
    if (present.length === 0) return
    const root = find(present[0]!)
    for (const name of present) parents.set(find(name), root)
  }
  for (const original of srj.connections) {
    const connection = original as typeof original & {
      __rootConnectionNames?: string[]
      __netConnectionName?: string
    }
    union([
      connection.name,
      connection.rootConnectionName,
      connection.netConnectionName,
      connection.__netConnectionName,
      ...(connection.mergedConnectionNames ?? []),
      ...(connection.__rootConnectionNames ?? []),
      ...connection.pointsToConnect.flatMap((point) => [
        point.pointId,
        point.pcb_port_id,
      ]),
    ])
  }
  for (const obstacle of srj.obstacles) union(obstacle.connectedTo)
  for (const route of routes)
    union([route.connectionName, route.rootConnectionName])
  for (const name of parents.keys()) parents.set(name, find(name))
  return parents
}
