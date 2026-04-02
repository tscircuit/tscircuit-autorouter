import { expect, test } from "bun:test"
import keyboard4 from "../../fixtures/legacy/assets/keyboard4.json" with {
  type: "json",
}
import { AutoroutingPipelineSolver5 } from "lib/autorouter-pipelines/AutoroutingPipeline5_HdCache/AutoroutingPipelineSolver5_HdCache"
import type { SimpleRouteJson } from "lib/types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

const EPSILON = 1e-3

const approxEqual = (a: number, b: number) => Math.abs(a - b) <= EPSILON

const pointMatches = (
  point: { x: number; y: number; z?: number },
  target: { x: number; y: number; z?: number },
) =>
  approxEqual(point.x, target.x) &&
  approxEqual(point.y, target.y) &&
  (point.z === undefined ||
    target.z === undefined ||
    approxEqual(point.z, target.z))

const pointInsideNode = (
  point: { x: number; y: number },
  node: Pick<NodeWithPortPoints, "center" | "width" | "height">,
) =>
  point.x >= node.center.x - node.width / 2 - EPSILON &&
  point.x <= node.center.x + node.width / 2 + EPSILON &&
  point.y >= node.center.y - node.height / 2 - EPSILON &&
  point.y <= node.center.y + node.height / 2 + EPSILON

const getConnectionThatChangesLayersInNode = (node: NodeWithPortPoints) => {
  const zByConnection = new Map<string, Set<number>>()

  for (const portPoint of node.portPoints) {
    if (!zByConnection.has(portPoint.connectionName)) {
      zByConnection.set(portPoint.connectionName, new Set())
    }
    zByConnection.get(portPoint.connectionName)?.add(portPoint.z)
  }

  const connectionName = Array.from(zByConnection.entries()).find(
    ([, zLevels]) => zLevels.size > 1,
  )?.[0]

  if (!connectionName) {
    throw new Error(
      `No layer-changing connection found in node ${node.capacityMeshNodeId}`,
    )
  }

  return connectionName
}

const getSingleRouteForConnectionPoint = (
  routes: HighDensityRoute[],
  connectionName: string,
  targetPoint: { x: number; y: number },
) => {
  const matchingRoutes = routes.filter(
    (route) =>
      route.connectionName === connectionName &&
      route.route.some((point) => pointMatches(point, targetPoint)),
  )

  expect(matchingRoutes).toHaveLength(1)

  return matchingRoutes[0]!
}

const getLayerTransitionsInsideNode = (
  route: HighDensityRoute,
  node: Pick<NodeWithPortPoints, "center" | "width" | "height">,
) => {
  const transitions: Array<{
    from: HighDensityRoute["route"][number]
    to: HighDensityRoute["route"][number]
  }> = []

  for (let i = 1; i < route.route.length; i++) {
    const previousPoint = route.route[i - 1]!
    const currentPoint = route.route[i]!

    if (previousPoint.z === currentPoint.z) continue
    if (
      !pointInsideNode(previousPoint, node) &&
      !pointInsideNode(currentPoint, node)
    ) {
      continue
    }

    transitions.push({ from: previousPoint, to: currentPoint })
  }

  return transitions
}

const getPortPointForLayer = (
  node: NodeWithPortPoints,
  connectionName: string,
  z: number,
) => {
  const portPoint = node.portPoints.find(
    (point) => point.connectionName === connectionName && point.z === z,
  )

  if (!portPoint) {
    throw new Error(
      `Missing z=${z} port point for ${connectionName} in ${node.capacityMeshNodeId}`,
    )
  }

  return portPoint
}

const createForceLocalHdCacheFetch = () =>
  Object.assign(
    async () =>
      new Response(
        JSON.stringify({
          ok: false,
          source: "none",
          pairCount: 0,
          bucketKey: "",
          bucketSize: 0,
          routes: null,
          drc: null,
          message: "force-local",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    {
      preconnect() {},
    },
  ) as typeof fetch

test(
  "keyboard4 pipeline5 keeps the cmn_16__sub_2_1 layer transition via after simplification",
  async () => {
    const srj = structuredClone(keyboard4 as SimpleRouteJson)
    const solver = new AutoroutingPipelineSolver5(srj, {
      hdCacheFetch: createForceLocalHdCacheFetch(),
    })

    await solver.solveAsync()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)

    const node = solver.highDensityNodePortPoints?.find(
      (candidate) => candidate.capacityMeshNodeId === "cmn_16__sub_2_1",
    )

    expect(node).toBeDefined()

    const connectionName = getConnectionThatChangesLayersInNode(node!)
    const topLayerEntry = getPortPointForLayer(node!, connectionName, 0)
    const bottomLayerExit = getPortPointForLayer(node!, connectionName, 1)
    const stitchedRoute = getSingleRouteForConnectionPoint(
      solver.highDensityStitchSolver?.mergedHdRoutes ?? [],
      connectionName,
      topLayerEntry,
    )
    const simplifiedRoute = getSingleRouteForConnectionPoint(
      solver.traceSimplificationSolver?.simplifiedHdRoutes ?? [],
      connectionName,
      { x: topLayerEntry.x, y: topLayerEntry.y },
    )

    const stitchedTransitionsInNode = getLayerTransitionsInsideNode(
      stitchedRoute,
      node!,
    )
    const simplifiedTransitionsInNode = getLayerTransitionsInsideNode(
      simplifiedRoute,
      node!,
    )

    expect(stitchedTransitionsInNode).toHaveLength(1)

    const expectedViaPoint = stitchedTransitionsInNode[0]!.to

    expect(
      stitchedRoute.vias.some((via) => pointMatches(via, expectedViaPoint)),
    ).toBe(true)
    expect(
      stitchedRoute.route.some((point) => pointMatches(point, topLayerEntry)),
    ).toBe(true)
    expect(
      stitchedRoute.route.some((point) => pointMatches(point, bottomLayerExit)),
    ).toBe(true)

    expect(
      simplifiedRoute.vias.some((via) => pointInsideNode(via, node!)),
    ).toBe(true)
    expect(simplifiedTransitionsInNode).toHaveLength(1)
    expect(simplifiedRoute.route[0]).toMatchObject({
      x: topLayerEntry.x,
      y: topLayerEntry.y,
      z: topLayerEntry.z,
    } satisfies Pick<PortPoint, "x" | "y" | "z">)
  },
  { timeout: 120_000 },
)
