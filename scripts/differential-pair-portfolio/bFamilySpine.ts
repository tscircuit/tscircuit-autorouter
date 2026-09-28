import {
  HighDensitySolverB01,
  type HighDensityObstacle,
} from "@tscircuit/high-density-b01"
import type { HighDensityRoute } from "../../lib/types/high-density-types"
import type { Obstacle } from "../../lib/types/srj-types"
import { mapLayerNameToZ } from "../../lib/utils/mapLayerNameToZ"

type SpinePoint = { x: number; y: number; z: number }
type Bounds = { minX: number; maxX: number; minY: number; maxY: number }

export type BFamilySpineInput = {
  bounds: Bounds
  layerCount: number
  start: SpinePoint
  end: SpinePoint
  traceWidth: number
  viaDiameter: number
  obstacles: Obstacle[]
  existingTraces: HighDensityRoute[]
  obstacleMargin?: number
  cellSizeMm?: number
  maxSearchIterations?: number
}

export type BFamilySpineAdapter = {
  solver: HighDensitySolverB01 | null
  routingBounds: Bounds
  limitations: string[]
  getCandidate(): SpinePoint[] | null
}

/** Route a physical thick spine in a bounded B01 window without scaling copper. */
export const bFamilySpine = (input: BFamilySpineInput): BFamilySpineAdapter => {
  const limitations: string[] = []
  const margin = input.obstacleMargin ?? 0.15
  const terminalRadius = Math.max(input.traceWidth, input.viaDiameter) / 2
  const bounds = { ...input.bounds }
  let unsupported = false
  for (const axis of ["x", "y"] as const) {
    const minimum = axis === "x" ? "minX" : "minY"
    const maximum = axis === "x" ? "maxX" : "maxY"
    const extent = input.bounds[maximum] - input.bounds[minimum]
    const requiredMin =
      Math.min(input.start[axis], input.end[axis]) - terminalRadius
    const requiredMax =
      Math.max(input.start[axis], input.end[axis]) + terminalRadius
    if (
      requiredMin < input.bounds[minimum] ||
      requiredMax > input.bounds[maximum]
    ) {
      limitations.push(
        `B01 ${axis} terminal envelope extends beyond board bounds`,
      )
      unsupported = true
    }
    if (requiredMax - requiredMin > 15) {
      limitations.push(`B01 ${axis} terminal envelope exceeds its 15 mm window`)
      unsupported = true
    }
    if (extent <= 15) continue
    const midpoint = (input.start[axis] + input.end[axis]) / 2
    bounds[minimum] = Math.max(
      input.bounds[minimum],
      Math.min(midpoint - 7.5, input.bounds[maximum] - 15),
    )
    bounds[maximum] = bounds[minimum] + 15
    limitations.push(
      `B01 searches only a 15 mm local ${axis} window; outside detours are unsearched`,
    )
  }
  if (
    input.existingTraces.some(
      (route) =>
        route.jumpers?.length ||
        route.route.some((point) => point.insideJumperPad),
    )
  ) {
    limitations.push("B01 adapter does not support immutable jumper copper")
    unsupported = true
  }
  const obstacles: HighDensityObstacle[] = input.obstacles.map(
    (obstacle, index) => {
      const zLayers =
        obstacle.__zLayers ??
        obstacle.zLayers ??
        obstacle.layers.map((layer) => mapLayerNameToZ(layer, input.layerCount))
      if (
        zLayers.length === 0 ||
        zLayers.some(
          (z) => !Number.isInteger(z) || z < 0 || z >= input.layerCount,
        )
      )
        throw new Error(`B01 obstacle ${index} has invalid layer assignments`)
      return {
        type: "rect",
        connectionName: `b_spine_obstacle_${index}`,
        center: { ...obstacle.center },
        width: obstacle.width,
        height: obstacle.height,
        ccwRotationDegrees: obstacle.ccwRotationDegrees,
        zLayers: [...zLayers],
      }
    },
  )
  for (const [index, route] of input.existingTraces.entries()) {
    obstacles.push({
      type: "route",
      connectionName: `b_spine_immutable_${index}`,
      traceThickness: Math.max(
        route.traceThickness,
        ...route.route.map(
          (point) => point.traceThickness ?? route.traceThickness,
        ),
      ),
      viaDiameter: route.viaDiameter,
      route: route.route.map(({ x, y, z }) => ({ x, y, z })),
      vias: route.vias.map((via) => {
        const layers = route.route.flatMap((point, pointIndex) => {
          const previous = route.route[pointIndex - 1]
          return previous &&
            previous.z !== point.z &&
            point.x === via.x &&
            point.y === via.y
            ? [previous.z, point.z]
            : []
        })
        return {
          x: via.x,
          y: via.y,
          ...(layers.length
            ? {
                zStart: Math.min(...layers),
                zEnd: Math.max(...layers),
              }
            : {}),
        }
      }),
    })
  }
  let solver: HighDensitySolverB01 | null = null
  if (!unsupported) {
    const cellSize = input.cellSizeMm ?? 0.1
    solver = new HighDensitySolverB01({
      nodeWithPortPoints: {
        capacityMeshNodeId: "b_pair_spine",
        center: {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2,
        },
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
        availableZ: Array.from(
          { length: input.layerCount },
          (_, index) => index,
        ),
        portPoints: [input.start, input.end].map((point) => ({
          ...point,
          connectionName: "b_pair_spine",
        })),
      },
      obstacles,
      traceThickness: input.traceWidth,
      viaDiameter: input.viaDiameter,
      traceMargin: margin,
      obstacleClearanceMargin: margin,
      viaMinDistFromBorder: input.viaDiameter / 2,
      highResolutionCellSize: cellSize,
      lowResolutionCellSize: cellSize * 4,
      stepMultiplier: 1,
      hyperParameters: { shuffleSeed: 0 },
    })
    solver.setup()
    solver.MAX_ITERATIONS = Math.min(
      solver.MAX_ITERATIONS,
      input.maxSearchIterations ?? 75_000,
    )
  }
  return {
    solver,
    routingBounds: bounds,
    limitations,
    getCandidate(): SpinePoint[] | null {
      if (!solver || !solver.solved || solver.failed) return null
      const output = solver.getOutput()
      if (output.length !== 1 || output[0]!.route.length < 2)
        throw new Error(
          "B01 solved a single spine without exactly one complete route",
        )
      const raw = output[0]!
      const candidate: SpinePoint[] = []
      for (const [index, point] of raw.route.entries()) {
        const previous = raw.route[index - 1]
        if (
          previous &&
          previous.z !== point.z &&
          Math.hypot(previous.x - point.x, previous.y - point.y) > 1e-8
        ) {
          // B01 getOutput replaces a terminal grid state with the exact port.
          // Restore its explicit via station before adding the planar port lead.
          if (index !== 1 && index !== raw.route.length - 1)
            throw new Error(
              "B01 returned a moving nonterminal layer transition",
            )
          const vias = raw.vias.filter(
            (via) =>
              Math.hypot(via.x - previous.x, via.y - previous.y) < 1e-8 ||
              Math.hypot(via.x - point.x, via.y - point.y) < 1e-8,
          )
          if (vias.length !== 1)
            throw new Error(
              "B01 terminal transition has no unique explicit via station",
            )
          const via = vias[0]!
          if (previous.x !== via.x || previous.y !== via.y)
            candidate.push({ x: via.x, y: via.y, z: previous.z })
          candidate.push({ x: via.x, y: via.y, z: point.z })
          if (point.x === via.x && point.y === via.y) continue
        }
        candidate.push({ x: point.x, y: point.y, z: point.z })
      }
      return candidate
    },
  }
}
