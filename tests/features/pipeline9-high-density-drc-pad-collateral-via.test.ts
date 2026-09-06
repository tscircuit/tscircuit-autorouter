import { expect, test } from "bun:test"
import {
  getForceScalesForEffort,
  getMaxTargetedCandidateAttemptsForEffort,
  MAX_ERROR_MOVE,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceFamily,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { isPipeline9HighDensityDrcCandidateBetter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityDrcCandidateBetter"
import {
  getPipeline9DrcErrors,
  type Pipeline9DrcError,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

type CapturedRoute = Omit<HighDensityRoute, "route"> & {
  route: (HighDensityRoute["route"][number] & Partial<PortPoint>)[]
}

test("Pipeline9 rejects the native pad-force family's collateral via move", (): void => {
  // Captured before Pipeline9's new HD stage in SRJ18 sample9, cmn4. The
  // nearby net36 wire is immutable during the target net21 fragment's force.
  const targetName = "source_trace_21__source_net_21_mst1"
  const fixedName = "source_trace_36__source_net_36_mst36"
  const route: CapturedRoute = {
    connectionName: targetName,
    rootConnectionName: "source_trace_21",
    regionId: "cmn_4__sub_0_0",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      {
        portPointId: "ce317_pp0_z0::0",
        x: -16.2,
        y: -5.624,
        z: 0,
        connectionName: targetName,
        rootConnectionName: "connectivity_net50",
        nextPortPointId: "ce358_pp0_z0::0",
      },
      { x: -16.098, y: -5.547, z: 0 },
      { x: -16.049, y: -5.345, z: 0 },
      { x: -16.049, y: -5.345, z: 1 },
      { x: -15.933, y: -5.445, z: 1 },
      { x: -15.794, y: -5.537, z: 1 },
      { x: -15.688, y: -5.563, z: 1 },
      { x: -15.586, y: -5.57, z: 1 },
      { x: -15.485, y: -5.572, z: 1 },
      { x: -15.386, y: -5.569, z: 1 },
      { x: -15.289, y: -5.56, z: 1 },
      { x: -15.196, y: -5.526, z: 1 },
      { x: -15.126, y: -5.489, z: 1 },
      { x: -15.126, y: -5.489, z: 0 },
      { x: -15.076, y: -5.547, z: 0 },
      {
        portPointId: "ce358_pp0_z0::0",
        x: -15.075,
        y: -5.649,
        z: 0,
        connectionName: targetName,
        rootConnectionName: "connectivity_net50",
        prevPortPointId: "ce317_pp0_z0::0",
      },
    ],
    vias: [
      { x: -16.049, y: -5.345 },
      { x: -15.126, y: -5.489 },
    ],
  }
  const fixedRoute: HighDensityRoute = {
    connectionName: fixedName,
    rootConnectionName: "source_trace_36",
    regionId: "cmn_4__sub_0_0",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -16.2, y: -4.749, z: 0 },
      { x: -16.2, y: -4.836, z: 0 },
      { x: -16.079, y: -4.907, z: 0 },
      { x: -15.963, y: -4.95, z: 0 },
      { x: -15.848, y: -4.993, z: 0 },
      { x: -15.774, y: -5.05, z: 0 },
      { x: -15.7, y: -5.139, z: 0 },
      { x: -15.659, y: -5.235, z: 0 },
      { x: -15.644, y: -5.341, z: 0 },
      { x: -15.653, y: -5.451, z: 0 },
      { x: -15.689, y: -5.547, z: 0 },
      { x: -15.788, y: -5.649, z: 0 },
    ],
    vias: [],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_4__sub_0_0",
    center: { x: -11.9605, y: -1.8360000000000012 },
    width: 8.479,
    height: 7.6259999999999994,
    availableZ: [0, 1, 2, 3],
    portPoints: [
      {
        ...route.route[0]!,
        x: -16.200000000000003,
        y: -5.6240000000000006,
        connectionName: targetName,
      },
      { ...route.route.at(-1)!, connectionName: targetName },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -18, maxX: -7, minY: -7, maxY: 3 },
    connections: [
      ...[route, fixedRoute].map((fragment) => ({
        name: fragment.connectionName,
        pointsToConnect: [fragment.route[0]!, fragment.route.at(-1)!].map(
          (point) => ({ x: point.x, y: point.y, layer: "top" }),
        ),
      })),
      {
        name: "pad123-owner",
        pointsToConnect: [
          {
            x: -16.8,
            y: -5.249,
            layer: "top",
            pcb_port_id: "pcb_port_123",
          },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: -16.8, y: -5.249 },
        width: 1.2,
        height: 0.3,
        layers: ["top"],
        connectedTo: ["pad123-owner", "pcb_port_123"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_123",
          pcb_port_id: "pcb_port_123",
        },
      },
    ],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const boardRoutes = [route, fixedRoute]
  const evaluator = createPipeline9HighDensityDrcEvaluator({
    connections: srj.connections.slice(0, 2),
    originalConnections: srj.connections,
    hdRoutes: boardRoutes,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    originalSrj: srj,
    srjWithPointPairs: srj,
    layerCount: 4,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
  })
  const errors = getPipeline9DrcErrors(evaluator, boardRoutes)
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    type: "pcb_pad_trace_clearance_error",
    pcb_pad_id: "pcb_smtpad_123",
    pcb_trace_id: `${targetName}_0`,
  })
  expect(errors[0]!.actual_clearance).toBeCloseTo(0.08401448724426523, 12)
  const original = structuredClone({ boardRoutes, node, srj, errors })
  const candidateErrors: Pipeline9DrcError[][] = []
  const candidates: HighDensityRoute[][] = []
  const attemptedFamilies: Pipeline9HighDensityForceFamily[] = []
  for (const candidate of getPipeline9HighDensityForceCandidates({
    node,
    hdRoutes: [route],
    errors,
    traceRouteIndexById: new Map([[`${targetName}_0`, 0]]),
    obstacles: srj.obstacles,
    layerCount: 4,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    connMap,
    forceContext: evaluator.getForceContext(boardRoutes),
    effort: 1,
    onCandidateAttempted: (family): void => {
      attemptedFamilies.push(family)
    },
  })) {
    // Preserve the hosted native-operator proof independently of the new
    // pad-wire family. Only the deliberate native trials belong to this test.
    if (attemptedFamilies.at(-1) !== "native") continue
    const nextErrors = getPipeline9DrcErrors(evaluator, [
      candidate[0]!,
      fixedRoute,
    ])
    candidates.push(candidate)
    candidateErrors.push(nextErrors)
    console.info(
      JSON.stringify({
        diagnostic: "sample9-pad123-collateral-via",
        candidateIndex: candidates.length - 1,
        firstVia: candidate[0]!.vias[0],
        accepted: isPipeline9HighDensityDrcCandidateBetter(nextErrors, errors),
        errors: nextErrors.map((error) => ({
          type: error.type,
          padId: error.pcb_pad_id,
          traceId: error.pcb_trace_id,
          viaOwners: error.__via_owner_trace_ids,
          segmentOwner: error.__trace_segment_owner_trace_id,
          actualClearance: error.actual_clearance,
        })),
      }),
    )
    expect(candidate[0]!.route[0]).toEqual(route.route[0])
    expect(candidate[0]!.route.at(-1)).toEqual(route.route.at(-1))
  }
  expect(candidates.length).toBeGreaterThan(0)
  expect(candidates.length).toBeLessThanOrEqual(
    getForceScalesForEffort(1).length *
      getMaxTargetedCandidateAttemptsForEffort(1),
  )
  // Native applyDrcErrorForces also moves the closest via away from the pad
  // center by MAX_ERROR_MOVE, using its pre-segment-move ViaNode coordinates.
  const firstVia = route.vias[0]!
  const padCenter = srj.obstacles[0]!.center
  const distance = Math.hypot(
    firstVia.x - padCenter.x,
    firstVia.y - padCenter.y,
  )
  expect(candidates[0]![0]!.vias[0]!.x).toBeCloseTo(
    firstVia.x + ((firstVia.x - padCenter.x) / distance) * MAX_ERROR_MOVE,
    12,
  )
  expect(candidates[0]![0]!.vias[0]!.y).toBeCloseTo(
    firstVia.y + ((firstVia.y - padCenter.y) / distance) * MAX_ERROR_MOVE,
    12,
  )
  const collateralError = candidateErrors[0]!.find(
    (error) =>
      error.type === "pcb_via_trace_clearance_error" &&
      error.__trace_segment_owner_trace_id === `${fixedName}_0` &&
      Array.isArray(error.__via_owner_trace_ids) &&
      error.__via_owner_trace_ids.includes(`${targetName}_0`),
  )
  expect(collateralError).toBeDefined()
  expect(collateralError!.actual_clearance).toBeCloseTo(0.06346992295170772, 12)
  expect(
    isPipeline9HighDensityDrcCandidateBetter(candidateErrors[0]!, errors),
  ).toBeFalse()
  expect({ boardRoutes, node, srj, errors }).toEqual(original)
})
