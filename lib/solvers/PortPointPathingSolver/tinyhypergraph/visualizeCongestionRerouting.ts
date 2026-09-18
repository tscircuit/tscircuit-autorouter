import type { GraphicsObject } from "graphics-debug"
import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import type { CapacityMeshNode } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import type { ReroutingPhase } from "./CongestionReroutingSolver"

type Point = { x: number; y: number }
type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type VisualizationInput = {
  solver: TinyHyperGraphSolver
  previousSolver: TinyHyperGraphSolver | null
  nodesByRegionId: ReadonlyMap<number, CapacityMeshNode>
  attempt: { regionId: number; routeId: number } | null
  phase: ReroutingPhase
  previousRegionPf: number
  regionPf: number
  maxPf: number
  focus: boolean
}

/** Clip actual path segments to the local debug viewport, without moving ports. */
function clipSegment(a: Point, b: Point, bounds: Bounds): Point[] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let start = 0
  let end = 1
  for (const [p, q] of [[-dx, a.x - bounds.minX], [dx, bounds.maxX - a.x], [-dy, a.y - bounds.minY], [dy, bounds.maxY - a.y]]) {
    if (p === 0) {
      if (q < 0) return null
      continue
    }
    if (p < 0) start = Math.max(start, q / p)
    else end = Math.min(end, q / p)
    if (start > end) return null
  }
  return [{ x: a.x + start * dx, y: a.y + start * dy }, { x: a.x + end * dx, y: a.y + end * dy }]
}

/** Both the debugger and video renderer consume this live solver state. */
export function visualizeCongestionRerouting(input: VisualizationInput): GraphicsObject {
  const { solver, attempt, phase } = input
  if (!attempt) return solver.visualize()
  const node = input.nodesByRegionId.get(attempt.regionId)
  if (!node) throw new Error(`Missing visualization node for region ${attempt.regionId}`)
  const radius = Math.max(node.width * 0.9, node.height * 0.9, 2)
  const bounds: Bounds = {
    minX: node.center.x - radius, maxX: node.center.x + radius,
    minY: node.center.y - radius, maxY: node.center.y + radius,
  }
  const graphics: GraphicsObject = input.focus ? { rects: [], lines: [], points: [] } : solver.visualize()
  const blocked = phase === "blocked" || phase === "searching"
  if (input.focus) {
    for (const region of input.nodesByRegionId.values()) {
      if (!region.availableZ.some(z => node.availableZ.includes(z))) continue
      const minX = Math.max(bounds.minX, region.center.x - region.width / 2)
      const maxX = Math.min(bounds.maxX, region.center.x + region.width / 2)
      const minY = Math.max(bounds.minY, region.center.y - region.height / 2)
      const maxY = Math.min(bounds.maxY, region.center.y + region.height / 2)
      if (minX >= maxX || minY >= maxY) continue
      graphics.rects!.push({ ...createRectFromCapacityNode(region),
        center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        width: maxX - minX, height: maxY - minY,
        fill: region._containsObstacle ? "rgba(255,0,0,0.12)" : "rgba(0,0,0,0.015)",
        stroke: "rgba(0,0,0,0.12)", label: undefined,
      })
    }
  }
  graphics.rects = (graphics.rects ?? []).filter(rect => !rect.label?.startsWith("TEMPORARY OBSTACLE:"))
  graphics.lines ??= []
  graphics.rects.push({ ...createRectFromCapacityNode(node), center: node.center,
    width: node.width, height: node.height,
    fill: blocked ? "rgba(255,0,0,0.28)" : "rgba(255,190,0,0.2)",
    stroke: blocked ? "red" : "#b8860b",
    label: `${node.capacityMeshNodeId}: ${blocked ? "TEMPORARY OBSTACLE" : "selected region"}\nroute ${attempt.routeId} only; z${node.availableZ.join(",")}\n${phase}; PF ${input.previousRegionPf.toFixed(3)} -> ${input.regionPf.toFixed(3)}; max PF ${input.maxPf.toFixed(3)}`,
  })
  // Preserve the removed route as a ghost, so rip-up is visible before search begins.
  const affectedRoutes = new Set(input.previousSolver?.state.regionSegments[attempt.regionId].map(([routeId]) => routeId))
  const sources = input.previousSolver ? [input.previousSolver, solver] : [solver]
  for (const [sourceIndex, source] of sources.entries()) {
    const ghost = sources.length === 2 && sourceIndex === 0
    for (const segments of source.state.regionSegments) {
      for (const [routeId, from, to] of segments) {
        if (ghost && routeId !== attempt.routeId) continue
        if (!input.focus && !ghost) continue
        const { topology } = source
        const a = { x: topology.portX[from], y: topology.portY[from] }
        const b = { x: topology.portX[to], y: topology.portY[to] }
        const points = input.focus ? clipSegment(a, b, bounds) : [a, b]
        if (!points) continue
        const z = topology.portZ[from]
        graphics.lines.push({ points,
          strokeColor: ghost ? "rgba(100,100,100,0.45)" : routeId === attempt.routeId ? "#2563eb" : affectedRoutes.has(routeId) ? "rgba(210,110,20,0.85)" : "rgba(100,100,100,0.15)",
          strokeDash: ghost ? "4 4" : !node.availableZ.includes(z) ? "6 3" : undefined,
          layer: `z${[...new Set([z, topology.portZ[to]])].join(",")}`,
          label: `${ghost ? "Previous path" : "Assigned path"}: route ${routeId}, z${z} to z${topology.portZ[to]}`,
        })
      }
    }
  }
  if (input.focus && phase === "searching") {
    const candidates = solver.state.candidateQueue.toArray().sort((a, b) => a.f - b.f)
    let cursor = candidates[0]
    while (cursor?.prevCandidate) {
      const previous = cursor.prevCandidate
      const points = clipSegment(
        { x: solver.topology.portX[previous.portId], y: solver.topology.portY[previous.portId] },
        { x: solver.topology.portX[cursor.portId], y: solver.topology.portY[cursor.portId] }, bounds)
      if (points) graphics.lines.push({ points, strokeColor: "#16a34a",
        strokeDash: node.availableZ.includes(solver.topology.portZ[cursor.portId]) ? undefined : "6 3",
        label: "Current search candidate", layer: `z${solver.topology.portZ[cursor.portId]}` })
      cursor = previous
    }
  }
  return graphics
}
