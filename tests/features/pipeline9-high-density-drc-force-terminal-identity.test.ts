import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { getPipeline9HighDensityForceCandidates } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("Pipeline9 local forces use inert HD terminal identities without changing public point metadata", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "terminal-node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    startPcbPortId: "port-a-start",
    endPcbPortId: "port-a-end",
    route: [
      { x: -4, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
    vias: [],
  }
  const originalRoute = structuredClone(route)
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "terminal-node",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    availableZ: [0, 1],
    portPoints: [
      { x: -4, y: 0, z: 0, connectionName: "A", pcb_port_id: "port-a-start" },
      { x: 4, y: 0, z: 0, connectionName: "A", pcb_port_id: "port-a-end" },
    ],
  }
  const connMap = new ConnectivityMap({
    A: ["A", "port-a-start", "port-a-end"],
    B: ["B", "port-b-start", "port-b-end"],
  })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
    obstacles: [
      ...[-4, 4].map((x) => ({
        type: "rect" as const,
        circuitJsonMetadata: {
          pcb_smtpad_id: x < 0 ? "pad-a-start" : "pad-a-end",
          pcb_port_id: x < 0 ? "port-a-start" : "port-a-end",
        },
        center: { x, y: 0 },
        width: 1.2,
        height: 1.2,
        layers: ["top"],
        connectedTo: ["A", x < 0 ? "port-a-start" : "port-a-end"],
      })),
      {
        type: "rect",
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad-b-start",
          pcb_port_id: "port-b-start",
        },
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["B", "port-b-start"],
      },
    ],
    connections: [
      {
        name: "A",
        pointsToConnect: node.portPoints.map((point) => ({
          x: point.x,
          y: point.y,
          layer: "top",
          pcb_port_id: point.pcb_port_id,
        })),
      },
      {
        name: "B",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "port-b-start" },
          { x: 0, y: 4, layer: "top", pcb_port_id: "port-b-end" },
        ],
      },
    ],
  }
  const drcEvaluator = createPipeline9HighDensityDrcEvaluator({
    connections: [srj.connections[0]!],
    originalConnections: srj.connections,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    hdRoutes: [route],
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
    originalSrj: srj,
    srjWithPointPairs: srj,
  })
  const initialErrors = getPipeline9DrcErrors(drcEvaluator, [route])
  expect(initialErrors.length).toBeGreaterThan(0)
  let repairedRoute: HighDensityRoute | undefined
  for (const candidate of getPipeline9HighDensityForceCandidates({
    node,
    hdRoutes: [route],
    errors: initialErrors,
    traceRouteIndexById: new Map([["A_0", 0]]),
    obstacles: srj.obstacles,
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    connMap,
    effort: 1,
  })) {
    if (getPipeline9DrcErrors(drcEvaluator, candidate).length === 0) {
      repairedRoute = candidate[0]
      break
    }
  }
  expect(repairedRoute).toBeDefined()
  expect(repairedRoute!.route[0]).toEqual(route.route[0])
  expect(repairedRoute!.route.at(-1)).toEqual(route.route.at(-1))
  expect(repairedRoute!.startPcbPortId).toBe(route.startPcbPortId)
  expect(repairedRoute!.endPcbPortId).toBe(route.endPcbPortId)
  expect(repairedRoute!.route.every((point) => !("pcb_port_id" in point))).toBe(
    true,
  )
  expect(route).toEqual(originalRoute)
})
