import { expect, test } from "bun:test"
import { applyDrcErrorForces } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { getPipeline9HighDensityForceCandidates } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { getPipeline9PadCopperForceTarget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PadCopperForceTarget"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types/srj-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("Pipeline9 targets a violating pad corner instead of a nearer clear segment", (): void => {
  // SRJ18 sample9's first two top-layer segments: segment0 is nearer the pad
  // center, but only segment1 violates its bottom-right copper corner.
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "corner-node",
    startPcbPortId: "A-start",
    endPcbPortId: "A-end",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -16.2, y: -5.624, z: 0 },
      { x: -16.098, y: -5.547, z: 0 },
      { x: -16.049, y: -5.345, z: 0 },
      { x: -15, y: -5.345, z: 0 },
    ],
    vias: [],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "corner-node",
    center: { x: -15.5, y: -5.5 },
    width: 3,
    height: 3,
    availableZ: [0, 1],
    portPoints: [
      { ...route.route[0]!, connectionName: "A", pcb_port_id: "A-start" },
      { ...route.route.at(-1)!, connectionName: "A", pcb_port_id: "A-end" },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -18, maxX: -13, minY: -8, maxY: -3 },
    connections: [
      {
        name: "A",
        pointsToConnect: [
          { x: -16.2, y: -5.624, layer: "top", pcb_port_id: "A-start" },
          { x: -15, y: -5.345, layer: "top", pcb_port_id: "A-end" },
        ],
      },
      ...["B", "C"].map((name, index): SimpleRouteConnection => ({
        name,
        pointsToConnect: [
          {
            x: -16.8,
            y: -5.249,
            layer: index === 0 ? "top" : "bottom",
            pcb_port_id: `${name}-start`,
          },
          {
            x: -17.5,
            y: -4,
            layer: index === 0 ? "top" : "bottom",
            pcb_port_id: `${name}-end`,
          },
        ],
      })),
    ],
    // Put the coincident, wrong-layer pad first to exercise exact pad identity
    // rather than an order-dependent nearest-obstacle choice.
    obstacles: ["C", "B"].map((name): Obstacle => ({
      type: "rect",
      center: { x: -16.8, y: -5.249 },
      width: 1.2,
      height: 0.3,
      layers: [name === "B" ? "top" : "bottom"],
      connectedTo: [name, `${name}-start`],
      circuitJsonMetadata: {
        pcb_smtpad_id: `pad-${name}`,
        pcb_port_id: `${name}-start`,
      },
    })),
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const evaluator = createPipeline9HighDensityDrcEvaluator({
    connections: [srj.connections[0]!],
    originalConnections: srj.connections,
    hdRoutes: [route],
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    originalSrj: srj,
    srjWithPointPairs: srj,
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
  })
  const errors = getPipeline9DrcErrors(evaluator, [route])
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    type: "pcb_pad_trace_clearance_error",
    pcb_pad_id: "pad-B",
    __pad_centers: [{ x: -16.8, y: -5.249 }],
  })
  expect(errors[0]!.actual_clearance).toBeCloseTo(0.08401448724426523, 12)
  const original = structuredClone({ route, node, srj, errors })
  const forceContext = evaluator.getForceContext([route])
  const pads = errors[0]!.__pad_copper as Record<string, unknown>[]
  const target = getPipeline9PadCopperForceTarget({
    pad: pads[0]!,
    route,
    obstacles: forceContext.obstacles,
    layerCount: 2,
  })
  expect(target?.segmentIndex).toBe(1)
  expect(target!.center.x).toBeCloseTo(-16.2, 12)
  expect(target!.center.y).toBeCloseTo(-5.399, 12)
  expect(target!.obstacles.map((obstacle) => obstacle.connectedTo)).toEqual([
    ["pad-B"],
  ])
  const oldCenterRoutes = structuredClone([route])
  oldCenterRoutes[0]!.connectionName = "A_0"
  oldCenterRoutes[0]!.rootConnectionName = "A_0"
  oldCenterRoutes[0]!.route[0]!.pcb_port_id = "A-start"
  oldCenterRoutes[0]!.route.at(-1)!.pcb_port_id = "A-end"
  const beforeOldForce = structuredClone(oldCenterRoutes)
  expect(
    applyDrcErrorForces(
      {
        bounds: srj.bounds,
        layerCount: 2,
        connections: [],
        minTraceWidth: 0.1,
        minViaDiameter: 0.3,
        obstacles: forceContext.obstacles,
        minTraceToPadEdgeClearance: 0.1,
      },
      oldCenterRoutes,
      [{ ...errors[0]!, center: { x: -16.8, y: -5.249 } }],
      new Map([["A_0", 0]]),
      1,
      forceContext.connMap,
    ),
  ).toBe(false)
  expect(oldCenterRoutes).toEqual(beforeOldForce)
  const attemptedErrorIndexes: number[] = []
  let repaired: HighDensityRoute[] | undefined
  for (const candidate of getPipeline9HighDensityForceCandidates({
    node,
    hdRoutes: [route],
    errors,
    traceRouteIndexById: new Map([["A_0", 0]]),
    obstacles: srj.obstacles,
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    connMap,
    forceContext,
    effort: 1,
    onErrorAttempted: (index): void => {
      attemptedErrorIndexes.push(index)
    },
  })) {
    if (getPipeline9DrcErrors(evaluator, candidate).length !== 0) continue
    repaired = candidate
    break
  }
  expect(repaired).toBeDefined()
  expect(getPipeline9DrcErrors(evaluator, repaired!)).toHaveLength(0)
  expect(repaired![0]!.route[0]).toEqual(route.route[0])
  expect(repaired![0]!.route.at(-1)).toEqual(route.route.at(-1))
  expect(attemptedErrorIndexes).toEqual([0])
  expect({ route, node, srj, errors }).toEqual(original)
})
