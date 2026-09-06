import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { createPipeline9RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9RelaxedDrcEvaluator"
import type { Pipeline9HighDensityForceContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceObstacles"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type {
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types/srj-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type ViaSpacingCase = {
  name: string
  separation: number
  ownership: "same-route" | "new-route" | "fixed-route"
  throughObstacle?: boolean
  differentNetBlindVias?: boolean
  expectedErrors: number
}

const createViaRoute = (
  connectionName: string,
  x: number,
): HighDensityRoute => ({
  connectionName,
  rootConnectionName: "shared-net",
  regionId: "via-node",
  traceThickness: 0.1,
  viaDiameter: 0.6,
  route: [
    { x, y: 0, z: 0 },
    { x, y: 0, z: 1 },
  ],
  vias: [{ x, y: 0 }],
})

test("Pipeline9 prechecks actual drill spacing across nets and route ownership", (): void => {
  const cases: ViaSpacingCase[] = [
    {
      name: "one route",
      separation: 0.25,
      ownership: "same-route",
      expectedErrors: 1,
    },
    {
      name: "separate fragments",
      separation: 0.25,
      ownership: "new-route",
      expectedErrors: 1,
    },
    {
      name: "fixed copper",
      separation: 0.25,
      ownership: "fixed-route",
      expectedErrors: 1,
    },
    {
      name: "coincident handoff",
      separation: 0.002,
      ownership: "new-route",
      expectedErrors: 0,
    },
    {
      name: "overlapping annuli with clear holes",
      separation: 0.35,
      ownership: "new-route",
      expectedErrors: 0,
    },
    {
      name: "plated obstacle transitions",
      separation: 0.25,
      ownership: "new-route",
      throughObstacle: true,
      expectedErrors: 0,
    },
    {
      name: "different-net blind vias on disjoint layer spans",
      separation: 0.25,
      ownership: "new-route",
      differentNetBlindVias: true,
      expectedErrors: 1,
    },
    {
      name: "different-net fixed blind via on a disjoint layer span",
      separation: 0.25,
      ownership: "fixed-route",
      differentNetBlindVias: true,
      expectedErrors: 1,
    },
  ]

  for (const scenario of cases) {
    const routeA = createViaRoute("A", 0)
    const routeB = createViaRoute("B", scenario.separation)
    const layerCount = scenario.differentNetBlindVias ? 4 : 2
    if (scenario.differentNetBlindVias) {
      routeA.rootConnectionName = "A"
      routeB.rootConnectionName = "B"
      routeB.route = routeB.route.map((point) => ({
        ...point,
        z: point.z + 2,
      }))
    }
    const hdRoutes = [routeA]
    const fixedHdRoutes: HighDensityRoute[] = []
    if (scenario.ownership === "same-route") {
      routeA.route.push(...[...routeB.route].reverse())
      routeA.vias.push(...routeB.vias)
    } else if (scenario.ownership === "fixed-route") {
      fixedHdRoutes.push(routeB)
    } else {
      hdRoutes.push(routeB)
    }
    if (scenario.throughObstacle) {
      routeA.route[0]!.toNextSegmentType = "through_obstacle"
      routeB.route[0]!.toNextSegmentType = "through_obstacle"
    }
    const connections: SimpleRouteConnection[] = [
      ...hdRoutes,
      ...fixedHdRoutes,
    ].map((route) => ({
      name: route.connectionName,
      __netConnectionName: route.rootConnectionName,
      pointsToConnect: [route.route[0]!, route.route.at(-1)!].map((point) => ({
        x: point.x,
        y: point.y,
        layer: mapZToLayerName(point.z, layerCount),
      })),
    }))
    const srj: SimpleRouteJson = {
      layerCount,
      minTraceWidth: 0.1,
      minViaDiameter: 0.6,
      minViaHoleDiameter: 0.2,
      bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
      obstacles: [],
      connections,
    }
    const connMap = new ConnectivityMap(
      scenario.differentNetBlindVias
        ? { A: ["A"], B: ["B"] }
        : { "shared-net": ["A", "B", "shared-net"] },
    )
    const evaluate = createPipeline9RelaxedDrcEvaluator({
      connections,
      originalConnections: connections,
      layerCount,
      obstacles: [],
      defaultViaHoleDiameter: 0.2,
      connMap,
      srjWithPointPairs: srj,
      originalSrj: srj,
      mutatedPreloadedTraces: [],
      drcOptions: { includeTraceContinuity: false, includeBoardEdge: false },
    })
    expect(
      getPipeline9DrcErrors(evaluate, [...hdRoutes, ...fixedHdRoutes]),
    ).toHaveLength(scenario.expectedErrors)
    const forceEvaluator = createPipeline9HighDensityDrcEvaluator({
      connections,
      originalConnections: connections,
      hdRoutes: [...hdRoutes, ...fixedHdRoutes],
      originalFixedHdRoutes: [],
      fixedHdRoutes: [],
      changedPreloadedTraceSections: [],
      layerCount,
      obstacles: [],
      defaultViaHoleDiameter: 0.2,
      connMap,
      originalSrj: srj,
      srjWithPointPairs: srj,
    })
    let evaluatorCallCount = 0
    const drcEvaluator = Object.assign(
      ({
        hdRoutes: candidateRoutes,
      }: Parameters<DrcEvaluator>[0]): ReturnType<DrcEvaluator> => {
        if (!candidateRoutes) {
          throw new Error("Expected high-density candidates")
        }
        evaluatorCallCount += 1
        return evaluate({
          hdRoutes: [...candidateRoutes, ...fixedHdRoutes],
          traces: [],
        })
      },
      {
        getForceContext: (
          candidateRoutes: HighDensityRoute[],
        ): Pipeline9HighDensityForceContext =>
          forceEvaluator.getForceContext([
            ...candidateRoutes,
            ...fixedHdRoutes,
          ]),
      },
    )
    const solver = new Pipeline9HighDensityDrcRepairSolver({
      nodePortPoints: [
        {
          capacityMeshNodeId: "via-node",
          center: { x: 0, y: 0 },
          width: 4,
          height: 4,
          portPoints: [],
        },
      ],
      hdRoutes,
      fixedHdRoutes,
      newConnections: connections.filter((connection) =>
        hdRoutes.some((route) => route.connectionName === connection.name),
      ),
      drcEvaluator,
      connMap,
      colorMap: {},
      obstacles: [],
      layerCount,
      viaDiameter: 0.6,
      viaHoleDiameter: 0.2,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      drcClearance: 0.1,
      effort: 0.1,
    })

    solver.step()

    expect({
      scenario: scenario.name,
      errors: solver.currentErrors.length,
    }).toEqual({ scenario: scenario.name, errors: scenario.expectedErrors })
    expect(evaluatorCallCount).toBe(1)
    expect(solver.stats.drcPrecheckFoundPotentialIssue).toBe(
      scenario.expectedErrors > 0,
    )
  }
})
