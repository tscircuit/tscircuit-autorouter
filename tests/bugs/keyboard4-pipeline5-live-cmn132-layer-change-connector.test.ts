import { expect, test } from "bun:test"
import keyboard4 from "../../fixtures/legacy/assets/keyboard4.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver5 } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/AutoroutingPipelineSolver5_HdCache"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import { MultiSimplifiedPathSolver } from "lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import type { SimpleRouteJson } from "lib/types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

const EPSILON = 1e-3

const approxEqual = (a: number, b: number) => Math.abs(a - b) <= EPSILON

const pointMatches = (
  point: { x: number; y: number },
  target: { x: number; y: number },
) => approxEqual(point.x, target.x) && approxEqual(point.y, target.y)

const pointInsideNode = (
  point: { x: number; y: number },
  node: Pick<NodeWithPortPoints, "center" | "width" | "height">,
) =>
  point.x >= node.center.x - node.width / 2 - EPSILON &&
  point.x <= node.center.x + node.width / 2 + EPSILON &&
  point.y >= node.center.y - node.height / 2 - EPSILON &&
  point.y <= node.center.y + node.height / 2 + EPSILON

const pointToSegmentDistance = (
  point: { x: number; y: number },
  segmentStart: { x: number; y: number },
  segmentEnd: { x: number; y: number },
) => {
  const dx = segmentEnd.x - segmentStart.x
  const dy = segmentEnd.y - segmentStart.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return Math.hypot(point.x - segmentStart.x, point.y - segmentStart.y)
  }

  let t =
    ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) /
    lengthSquared
  t = Math.max(0, Math.min(1, t))

  const projection = {
    x: segmentStart.x + t * dx,
    y: segmentStart.y + t * dy,
  }

  return Math.hypot(point.x - projection.x, point.y - projection.y)
}

const runSimplificationLoop = (
  routes: HighDensityRoute[],
  context: Pick<
    AutoroutingPipelineSolver5,
    "srj" | "colorMap" | "connMap" | "viaDiameter"
  >,
) => {
  const viaRemoval = new UselessViaRemovalSolver({
    unsimplifiedHdRoutes: routes,
    obstacles: context.srj.obstacles,
    colorMap: context.colorMap,
    layerCount: context.srj.layerCount,
  })
  viaRemoval.solve()

  expect(viaRemoval.failed).toBe(false)

  const viaMergedRoutes = viaRemoval.getOptimizedHdRoutes()
  expect(viaMergedRoutes).not.toBeNull()
  const viaMerger = new SameNetViaMergerSolver({
    inputHdRoutes: viaMergedRoutes!,
    obstacles: context.srj.obstacles,
    colorMap: context.colorMap,
    layerCount: context.srj.layerCount,
    connMap: context.connMap,
    outline: context.srj.outline,
  })
  viaMerger.solve()

  expect(viaMerger.failed).toBe(false)
  const mergedViaRoutes = viaMerger.getMergedViaHdRoutes()
  expect(mergedViaRoutes).not.toBeNull()

  const pathSimplifier = new MultiSimplifiedPathSolver({
    unsimplifiedHdRoutes: mergedViaRoutes!,
    obstacles: context.srj.obstacles,
    connMap: context.connMap,
    colorMap: context.colorMap,
    outline: context.srj.outline,
    defaultViaDiameter: context.viaDiameter,
  })
  pathSimplifier.solve()

  expect(pathSimplifier.failed).toBe(false)

  return pathSimplifier.simplifiedHdRoutes
}

const getRouteByConnectionName = (
  routes: HighDensityRoute[],
  connectionName: string,
) => {
  const route = routes.find(
    (candidate) => candidate.connectionName === connectionName,
  )

  expect(route).toBeDefined()

  return route!
}

const getMinSameLayerSegmentDistanceToViaInNode = (
  route: HighDensityRoute,
  via: { x: number; y: number },
  node: Pick<NodeWithPortPoints, "center" | "width" | "height">,
) => {
  let minDistance = Infinity

  for (let i = 1; i < route.route.length; i++) {
    const previousPoint = route.route[i - 1]!
    const currentPoint = route.route[i]!

    if (previousPoint.z !== currentPoint.z) continue
    if (
      !pointInsideNode(previousPoint, node) &&
      !pointInsideNode(currentPoint, node)
    ) {
      continue
    }

    minDistance = Math.min(
      minDistance,
      pointToSegmentDistance(via, previousPoint, currentPoint),
    )
  }

  return minDistance
}

test(
  "keyboard4 live Pipeline5 keeps cmn_132 layer-change connectors away from the neighboring via in loop 2",
  async () => {
    const pipeline = new AutoroutingPipelineSolver5(
      structuredClone(keyboard4 as SimpleRouteJson),
    )

    while (
      pipeline.solved === false &&
      pipeline.failed === false &&
      pipeline.getCurrentPhase() !== "traceSimplificationSolver"
    ) {
      await pipeline.stepAsync()
    }

    expect(pipeline.failed).toBe(false)
    expect(pipeline.highDensityStitchSolver?.mergedHdRoutes).toBeDefined()

    const node = pipeline.highDensityNodePortPoints?.find(
      (candidate) => candidate.capacityMeshNodeId === "cmn_132",
    )

    expect(node).toBeDefined()

    const loop1Routes = runSimplificationLoop(
      structuredClone(pipeline.highDensityStitchSolver?.mergedHdRoutes ?? []),
      pipeline,
    )
    const loop2Routes = runSimplificationLoop(
      structuredClone(loop1Routes),
      pipeline,
    )

    const sourceNet7Route = getRouteByConnectionName(
      loop2Routes,
      "source_net_7_mst3",
    )
    const sourceNet6Route = getRouteByConnectionName(
      loop2Routes,
      "source_net_6_mst3",
    )
    const neighboringVia = sourceNet6Route.vias.find((via) =>
      pointMatches(via, { x: -11.95, y: -38.91 }),
    )

    expect(neighboringVia).toBeDefined()

    const minDistance = getMinSameLayerSegmentDistanceToViaInNode(
      sourceNet7Route,
      neighboringVia!,
      node!,
    )

    expect(minDistance).toBeGreaterThanOrEqual(0.2)
  },
  { timeout: 120_000 },
)
