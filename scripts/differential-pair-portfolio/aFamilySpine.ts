import { HighDensitySolverA13WithDrcValidation } from "../../lib/solvers/HyperHighDensitySolver/HighDensitySolverA13WithDrcValidation"
import type { HighDensityRoute } from "../../lib/types/high-density-types"
import type { Obstacle, SimpleRouteJson } from "../../lib/types"
import { convertHdRouteToSimplifiedRoute } from "../../lib/utils/convertHdRouteToSimplifiedRoute"
import { getObstaclesFromSrjTraces } from "../../lib/utils/convertSrjTracesToObstacles"

export type AFamilySpinePoint = { x: number; y: number; z: number }
export type AFamilySpineInput = {
  bounds: SimpleRouteJson["bounds"]
  layerCount: number
  start: AFamilySpinePoint
  end: AFamilySpinePoint
  /** Full outer copper envelope of the two lanes, not either lane's width. */
  traceWidth: number
  /** Diameter enclosing both paired vias, including their centerline spacing. */
  viaDiameter: number
  obstacles: Obstacle[]
  /** Other copper only: exclude both pair members being replaced. */
  existingTraces: HighDensityRoute[]
  obstacleMargin?: number
  cellSizeMm?: number
  maxSearchIterations?: number
  shuffleSeed?: number
}
export type AFamilySpineResult =
  | { status: "unsupported"; reason: string }
  | {
      status: "ready"
      solver: HighDensitySolverA13WithDrcValidation
      limitations: string[]
      getCandidate: () => AFamilySpinePoint[] | null
    }

/** Actual A13 search plus the existing board-copper rejection wrapper. */
export function createAFamilySpine(
  input: AFamilySpineInput,
): AFamilySpineResult {
  const { bounds, layerCount } = input
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const cellSizeMm = input.cellSizeMm ?? 0.1
  if (
    ![
      bounds.minX,
      bounds.maxX,
      bounds.minY,
      bounds.maxY,
      cellSizeMm,
      input.traceWidth,
      input.viaDiameter,
    ].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    cellSizeMm <= 0 ||
    input.traceWidth <= 0 ||
    input.viaDiameter <= 0 ||
    !Number.isInteger(layerCount) ||
    layerCount < 1
  )
    throw new Error(
      "A-family spine requires finite positive board and copper dimensions",
    )
  for (const point of [input.start, input.end]) {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isInteger(point.z) ||
      point.z < 0 ||
      point.z >= layerCount ||
      point.x < bounds.minX ||
      point.x > bounds.maxX ||
      point.y < bounds.minY ||
      point.y > bounds.maxY
    ) {
      throw new Error(
        "A-family spine endpoint is outside its board or layer stack",
      )
    }
  }
  const gridStates =
    (Math.ceil(width / cellSizeMm) + 1) *
    (Math.ceil(height / cellSizeMm) + 1) *
    layerCount
  if (gridStates > 2_000_000) {
    return {
      status: "unsupported",
      reason: `A13 grid needs ${gridStates} states; limit is 2000000`,
    }
  }
  if (input.existingTraces.some((route) => (route.jumpers?.length ?? 0) > 0)) {
    return {
      status: "unsupported",
      reason:
        "A-family spine obstacle conversion does not support jumper copper",
    }
  }
  const connectionName = "__differential_pair_spine__"
  if (
    input.existingTraces.some(
      (route) => route.connectionName === connectionName,
    ) ||
    input.obstacles.some((obstacle) =>
      obstacle.connectedTo.includes(connectionName),
    )
  ) {
    throw new Error(
      "A-family spine reserved connection name collides with input copper",
    )
  }
  const srj: SimpleRouteJson = {
    bounds,
    layerCount,
    minTraceWidth: input.traceWidth,
    minViaDiameter: input.viaDiameter,
    connections: [],
    obstacles: input.obstacles,
    traces: input.existingTraces.map((route, index) => ({
      type: "pcb_trace",
      pcb_trace_id: `spine_existing_${index}`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, layerCount),
    })),
  }
  const solver = new HighDensitySolverA13WithDrcValidation({
    nodeWithPortPoints: {
      capacityMeshNodeId: "differential_pair_spine",
      center: {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      },
      width,
      height,
      availableZ: Array.from({ length: layerCount }, (_, index) => index),
      portPoints: [input.start, input.end].map((point) => ({
        ...point,
        connectionName,
      })),
    },
    obstacles: [...input.obstacles, ...getObstaclesFromSrjTraces(srj)],
    layerCount,
    traceThickness: input.traceWidth,
    viaDiameter: input.viaDiameter,
    traceMargin: input.obstacleMargin ?? 0.1,
    viaMinDistFromBorder: input.viaDiameter / 2,
    cellSizeMm,
    stepMultiplier: 128,
    maxRounds: 20,
    maxSearchIterations: input.maxSearchIterations ?? 250_000,
    hyperParameters: { shuffleSeed: input.shuffleSeed ?? 0 },
  })
  return {
    status: "ready",
    solver,
    limitations: [
      "A13 searches without fixed copper; the board-copper wrapper rejects obstructed spines after search rather than finding obstacle detours.",
      "Existing traces are represented by rotated segment rectangles and via obstacles; final expanded-pair validation remains mandatory.",
      "Spine envelope is provisional: lane offsets, corner miters, terminal fanout and paired vias must pass the caller's exact validator.",
    ],
    getCandidate: (): AFamilySpinePoint[] | null => {
      if (!solver.solved || solver.failed) return null
      const routes = solver.getOutput()
      if (routes.length !== 1 || routes[0]!.connectionName !== connectionName) {
        throw new Error("A13 spine output lost its sole synthetic connection")
      }
      const path = routes[0]!.route
        .map(({ x, y, z }) => ({ x, y, z }))
        .filter(
          (point, index, points) =>
            index === 0 ||
            point.x !== points[index - 1]!.x ||
            point.y !== points[index - 1]!.y ||
            point.z !== points[index - 1]!.z,
        )
      // A13 snaps terminals to its grid; sub-cell stubs can backtrack and create
      // crossing lane offsets. Keep exact terminals and layer transitions; the
      // caller validates the expanded copper after this provisional shortcut.
      const maximumStubLength = cellSizeMm * Math.SQRT2 + 1e-9
      while (
        path.length > 2 &&
        path[1]!.z === path[0]!.z &&
        path[2]!.z === path[0]!.z &&
        Math.hypot(path[1]!.x - path[0]!.x, path[1]!.y - path[0]!.y) <=
          maximumStubLength
      ) {
        path.splice(1, 1)
      }
      while (
        path.length > 2 &&
        path.at(-2)!.z === path.at(-1)!.z &&
        path.at(-3)!.z === path.at(-1)!.z &&
        Math.hypot(
          path.at(-2)!.x - path.at(-1)!.x,
          path.at(-2)!.y - path.at(-1)!.y,
        ) <= maximumStubLength
      ) {
        path.splice(path.length - 2, 1)
      }
      return path
    },
  }
}
