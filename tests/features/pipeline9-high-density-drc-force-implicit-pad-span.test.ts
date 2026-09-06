import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { getPipeline9HighDensityForceCandidates } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { isPipeline9HighDensityDrcCandidateBetter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityDrcCandidateBetter"
import { getPipeline9FixedRouteObstacles } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("Pipeline9 repairs local copper while preserving an untagged connected-pad transition", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "pad-span-node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    startPcbPortId: "A-start",
    endPcbPortId: "A-end",
    route: [
      { x: -4, y: 1, z: 1 },
      { x: -3, y: 1, z: 0 },
      { x: -3, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 0, z: 1 },
    ],
    vias: [{ x: 4, y: 0 }],
  }
  const fixedRoute: HighDensityRoute = {
    connectionName: "C",
    rootConnectionName: "C",
    regionId: "fixed-node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -5, y: 3, z: 0 },
      { x: 5, y: 3, z: 0 },
    ],
    vias: [],
  }
  const inputRoutes = [route, fixedRoute]
  const originalRoutes = structuredClone(inputRoutes)
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "pad-span-node",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    availableZ: [0, 1],
    portPoints: [
      { x: -4, y: 1, z: 1, connectionName: "A", pcb_port_id: "A-start" },
      { x: 4, y: 0, z: 1, connectionName: "A", pcb_port_id: "A-end" },
    ],
  }
  const connMap = new ConnectivityMap({
    A: ["A", "A-start", "A-end"],
    B: ["B", "B-start", "B-end"],
    C: ["C"],
  })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
    obstacles: [
      {
        type: "rect",
        circuitJsonMetadata: {
          pcb_plated_hole_id: "connected-through-pad",
          pcb_port_id: "A-start",
        },
        center: { x: -3.5, y: 1 },
        width: 1.4,
        height: 0.8,
        layers: ["top", "bottom"],
        connectedTo: ["A", "A-start"],
      },
      {
        type: "rect",
        circuitJsonMetadata: {
          pcb_smtpad_id: "foreign-pad",
          pcb_port_id: "B-start",
        },
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["B", "B-start"],
      },
    ],
    connections: [
      {
        name: "A",
        pointsToConnect: [
          { x: -4, y: 1, layer: "bottom", pcb_port_id: "A-start" },
          { x: 4, y: 0, layer: "bottom", pcb_port_id: "A-end" },
        ],
      },
      {
        name: "B",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "B-start" },
          { x: 0, y: 4, layer: "top", pcb_port_id: "B-end" },
        ],
      },
      {
        name: "C",
        pointsToConnect: [
          { x: -5, y: 3, layer: "top" },
          { x: 5, y: 3, layer: "top" },
        ],
      },
    ],
  }
  const conversionOptions = {
    obstacles: srj.obstacles,
    connMap,
    defaultViaHoleDiameter: 0.15,
  }
  const originalSerializedRoute = convertHdRouteToSimplifiedRoute(
    route,
    2,
    conversionOptions,
  )
  expect(
    originalSerializedRoute.filter(
      (segment) => segment.route_type === "through_obstacle",
    ),
  ).toHaveLength(1)
  const originalTransitions = originalSerializedRoute.filter(
    (segment) => segment.route_type !== "wire",
  )
  const drcEvaluator = createPipeline9HighDensityDrcEvaluator({
    connections: [srj.connections[0]!, srj.connections[2]!],
    originalConnections: srj.connections,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    hdRoutes: inputRoutes,
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
    originalSrj: srj,
    srjWithPointPairs: srj,
  })
  const initialErrors = getPipeline9DrcErrors(drcEvaluator, inputRoutes)
  expect(initialErrors.length).toBeGreaterThan(0)
  const forceParams = {
    node,
    hdRoutes: [route],
    errors: initialErrors,
    traceRouteIndexById: new Map([["A_0", 0]]),
    obstacles: [
      ...srj.obstacles,
      ...getPipeline9FixedRouteObstacles({
        fixedObstacleRoutes: [fixedRoute],
        layerCount: 2,
      }),
    ],
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    connMap,
    effort: 1,
  }
  let improvedRoute: HighDensityRoute | undefined
  for (const candidate of getPipeline9HighDensityForceCandidates(forceParams)) {
    const errors = getPipeline9DrcErrors(drcEvaluator, [
      candidate[0]!,
      fixedRoute,
    ])
    if (isPipeline9HighDensityDrcCandidateBetter(errors, initialErrors)) {
      improvedRoute = candidate[0]
      break
    }
  }
  expect(improvedRoute).toBeDefined()
  expect(improvedRoute!.route.slice(0, 2)).toEqual(route.route.slice(0, 2))
  expect(improvedRoute!.route.slice(-2)).toEqual(route.route.slice(-2))
  expect(improvedRoute!.vias).toEqual(route.vias)
  expect(improvedRoute!.startPcbPortId).toBe(route.startPcbPortId)
  expect(improvedRoute!.endPcbPortId).toBe(route.endPcbPortId)
  expect(
    improvedRoute!.route.every(
      (point) => !("pcb_port_id" in point) && !("toNextSegmentType" in point),
    ),
  ).toBe(true)
  expect(
    convertHdRouteToSimplifiedRoute(
      improvedRoute!,
      2,
      conversionOptions,
    ).filter((segment) => segment.route_type !== "wire"),
  ).toEqual(originalTransitions)

  // No obstacle witnesses this different-XY jump. It must remain invalid,
  // rather than being relabeled through-obstacle to admit a force candidate.
  const invalidRoute: HighDensityRoute = {
    ...route,
    route: route.route.map((point, index) =>
      index === 1 ? { ...point, y: 2 } : { ...point },
    ),
  }
  expect([
    ...getPipeline9HighDensityForceCandidates({
      ...forceParams,
      hdRoutes: [invalidRoute],
    }),
  ]).toHaveLength(0)
  expect(inputRoutes).toEqual(originalRoutes)
})
