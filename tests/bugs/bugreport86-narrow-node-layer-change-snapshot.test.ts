import { expect, test } from "bun:test"
import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/buildHyperGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type {
  CapacityMeshNode,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import bugReport from "../../fixtures/bug-reports/bugreport86-40bf8e/bugreport86-40bf8e.json" with {
  type: "json",
}
import fixtureJson from "../../fixtures/bug-reports/bugreport86-40bf8e/bugreport86-40bf8e-port-point-pathing.json" with {
  type: "json",
}

type FixtureData = {
  capacityMeshNodes: CapacityMeshNode[]
  segmentPortPoints: SegmentPortPoint[]
  simpleRouteJsonConnections: SimpleRouteConnection[]
  layerCount: number
  minViaPadDiameter: number
}

test("port point pathing narrow node layer change snapshot", (): void => {
  const fixture = fixtureJson as FixtureData
  const connectivityMap = getConnectivityMapFromSimpleRouteJson(
    bugReport.simple_route_json as SimpleRouteJson,
  )

  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes: fixture.capacityMeshNodes,
    layerCount: fixture.layerCount,
    connectivityMap,
    segmentPortPoints: fixture.segmentPortPoints,
    simpleRouteJsonConnections: fixture.simpleRouteJsonConnections,
  })

  const solver = new TinyHypergraphPortPointPathingSolver({
    graph,
    connections,
    layerCount: fixture.layerCount,
    effort: 1,
    preserveTerminalPcbPortIds: true,
    minViaPadDiameter: fixture.minViaPadDiameter,
    flags: {
      FORCE_CENTER_FIRST: true,
      RIPPING_ENABLED: true,
      USE_SELECTIVE_RERIP_ROUTING: true,
    },
    weights: {
      SHUFFLE_SEED: 0,
      MEMORY_PF_FACTOR: 4,
      CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
      CENTER_OFFSET_FOCUS_SHIFT: 0,
      NODE_PF_FACTOR: 0,
      LAYER_CHANGE_COST: 0,
      RIPPING_PF_COST: 0,
      NODE_PF_MAX_PENALTY: 100,
      BASE_CANDIDATE_COST: 0.6,
      MAX_ITERATIONS_PER_PATH: 0,
      RANDOM_WALK_DISTANCE: 0,
      START_RIPPING_PF_THRESHOLD: 0.3,
      END_RIPPING_PF_THRESHOLD: 1,
      MAX_RIPS: 1000,
      RANDOM_RIP_FRACTION: 0.3,
      STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 4,
      GREEDY_MULTIPLIER: 0.7,
      MIN_ALLOWED_BOARD_SCORE: -10000,
    },
  })

  solver.solve()

  expect(solver.error).toBeNull()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  const center = { x: -0.56, y: -8.0 }
  const halfSize = 1.8 / 2
  const isInside = (p: { x: number; y: number }): boolean =>
    Math.abs(p.x - center.x) <= halfSize && Math.abs(p.y - center.y) <= halfSize

  const output = solver.getOutput()
  const highlightedNodes = output.nodesWithPortPoints.filter((node) => {
    const minDimension = Math.min(node.width, node.height)
    if (minDimension >= fixture.minViaPadDiameter) return false
    return (node.portPointsInPairs ?? []).some(([p1, p2]) => p1.z !== p2.z)
  })

  const overlayRects = highlightedNodes.map((node) => {
    const minDimension = Math.min(node.width, node.height)
    return {
      center: node.center,
      width: node.width,
      height: node.height,
      fill: "rgba(217, 70, 239, 0.75)",
      stroke: "#a21caf",
      label: `layer change in ${minDimension.toFixed(2)}mm node`,
    }
  })

  const viz = solver.visualize()

  const filtered: GraphicsObject = {
    rects: [
      ...(viz.rects?.filter((r) => isInside(r.center)) ?? []),
      ...overlayRects,
    ],
    points: viz.points?.filter((p) => isInside(p)),
    circles: viz.circles?.filter((c) => isInside(c.center)),
    lines: viz.lines?.filter((l) => l.points.some(isInside)),
    texts: [
      {
        x: center.x,
        y: center.y + halfSize - 0.05,
        text: "Magenta: nodes smaller than a via where a route changes layer",
        fontSize: 0.05,
        anchorSide: "top_center",
      },
    ],
  }

  const svg = getSvgFromGraphicsObject(filtered, { backgroundColor: "white" })
  expect(svg).toMatchSvgSnapshot(import.meta.path)
})
