import { expect, test } from "bun:test"
import type { Pipeline9RegionalB01RepairParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import { preparePipeline9TracePairRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preparePipeline9TracePairRepair"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("whole trace-pair candidates preserve interior anchors and special copper contracts", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "a",
      rootConnectionName: "a",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "b",
      rootConnectionName: "b",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      vias: [],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    obstacles: [],
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [route.route[0]!, route.route.at(-1)!].map((point) => ({
        x: point.x,
        y: point.y,
        layer: "top",
      })),
    })),
  }
  const params: Pipeline9RegionalB01RepairParams & {
    routeIndexes: [number, number]
  } = {
    srj,
    routes,
    fixedObstacleRoutes: [],
    newConnections: srj.connections,
    syntheticConnectionNames: new Set(),
    drcEvaluator: (): [] => [],
    preloadRepairTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.1,
    effort: 1,
    routeIndexes: [0, 1],
  }
  expect(preparePipeline9TracePairRepair(params)).toBeDefined()
  const original = structuredClone(routes)
  const pointChanges: Array<Partial<HighDensityRoute["route"][number]>> = [
    { pcb_port_id: "interior_terminal" },
    { insideJumperPad: true },
    { toNextSegmentType: "through_obstacle" },
    { toNextSegmentCircuitJsonMetadata: { pcb_smtpad_id: "fixed_pad" } },
    { traceThickness: 0.3 },
    { x: 3 },
  ]
  for (const change of pointChanges) {
    const changedRoutes = structuredClone(routes)
    Object.assign(changedRoutes[0]!.route[1]!, change)
    expect(
      preparePipeline9TracePairRepair({ ...params, routes: changedRoutes }),
    ).toBeUndefined()
  }
  const jumperRoutes = structuredClone(routes)
  jumperRoutes[0]!.jumpers = [
    {
      route_type: "jumper",
      start: { x: -0.5, y: 0 },
      end: { x: 0.5, y: 0 },
      footprint: "0603",
    },
  ]
  expect(
    preparePipeline9TracePairRepair({ ...params, routes: jumperRoutes }),
  ).toBeUndefined()
  expect(
    preparePipeline9TracePairRepair({
      ...params,
      syntheticConnectionNames: new Set(["a"]),
    }),
  ).toBeUndefined()
  const branch: HighDensityRoute = {
    ...routes[0]!,
    connectionName: "a_branch",
    route: [
      { x: 0.5, y: 0, z: 0 },
      { x: 0.5, y: 0.5, z: 0 },
    ],
  }
  expect(
    preparePipeline9TracePairRepair({ ...params, routes: [...routes, branch] }),
  ).toBeUndefined()
  expect(
    preparePipeline9TracePairRepair({
      ...params,
      fixedObstacleRoutes: [
        {
          ...branch,
          preloadedTraceIndex: 0,
          preloadedRouteIndex: 0,
        },
      ],
    }),
  ).toBeUndefined()
  const endpointBranch = {
    ...branch,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: -1, y: 0.5, z: 0 },
    ],
  }
  expect(
    preparePipeline9TracePairRepair({
      ...params,
      routes: [...routes, endpointBranch],
    }),
  ).toBeDefined()
  expect(routes).toEqual(original)
})
