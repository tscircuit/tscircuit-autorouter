import { expect, test } from "bun:test"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { asRegionalRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import { Pipeline9InheritedDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InheritedDrcRepairSolver"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createPipeline9InheritedPadClearanceFixture } from "../fixtures/create-pipeline9-inherited-pad-clearance-fixture"

test("Pipeline9 inherited rejection preserves the completed joint board despite speculative mutation", (): void => {
  const fixture = createPipeline9InheritedPadClearanceFixture()
  const originalSrj = structuredClone(fixture.srj)
  const newConnection: SimpleRouteConnection = {
    name: "new_bottom_route",
    pointsToConnect: [
      {
        x: -2,
        y: 1.25,
        layer: "bottom",
        pointId: "bottom_start",
        pcb_port_id: "bottom_start",
      },
      {
        x: 2,
        y: 1.25,
        layer: "bottom",
        pointId: "bottom_end",
        pcb_port_id: "bottom_end",
      },
    ],
  }
  originalSrj.connections.push(newConnection)
  for (const point of newConnection.pointsToConnect) {
    originalSrj.obstacles.push({
      type: "rect",
      center: { x: point.x, y: point.y },
      width: 0.5,
      height: 0.5,
      layers: ["bottom"],
      connectedTo: [point.pcb_port_id!],
      circuitJsonMetadata: {
        pcb_smtpad_id: `pad_${point.pcb_port_id}`,
        pcb_port_id: point.pcb_port_id,
      },
    })
  }
  const newRoute: HighDensityRoute = {
    connectionName: newConnection.name,
    rootConnectionName: newConnection.name,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 1.25, z: 1, pcb_port_id: "bottom_start" },
      { x: 0, y: 1.25, z: 1 },
      { x: 2, y: 1.25, z: 1, pcb_port_id: "bottom_end" },
    ],
    vias: [],
  }
  const preMutatedTrace = structuredClone(originalSrj.traces![0]!)
  preMutatedTrace.__replaces_pcb_trace_id = preMutatedTrace.pcb_trace_id
  for (const point of preMutatedTrace.route.slice(1, -1)) {
    if (point.route_type === "wire") point.y = -0.36
  }
  const callerConnMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  callerConnMap.addConnections([["completed_joint_alias"]])
  const primaryNet = callerConnMap.getNetConnectedToId("preloaded")
  const aliasNet = callerConnMap.getNetConnectedToId("completed_joint_alias")
  if (!primaryNet || !aliasNet) {
    throw new Error("Expected two established connectivity networks")
  }
  callerConnMap.addConnections([["preloaded", "completed_joint_alias"]])
  expect(callerConnMap.netMap[aliasNet]).toBe(callerConnMap.netMap[primaryNet])
  const previousJoint = new Pipeline9JointDrcRepairSolver({
    ...fixture.solver.getConstructorParams()[0],
    srj: originalSrj,
    srjWithPointPairs: originalSrj,
    originalSrj,
    newConnections: [newConnection],
    newHdRoutes: [newRoute],
    updatedPreloadedTraces: [preMutatedTrace],
    mutatedPreloadedTraceIds: new Set([preMutatedTrace.pcb_trace_id]),
    obstacles: originalSrj.obstacles,
    connMap: callerConnMap,
  })
  // The original joint stage still excludes inherited baseline errors.
  expect(previousJoint.solved).toBeTrue()
  expect(previousJoint.stats.initialJointDrcIssueCount).toBe(0)
  expect(previousJoint.movablePreloadedSections).toHaveLength(0)
  const acceptedNewRoutes = previousJoint.getOutput()
  const acceptedPreloads = previousJoint.getUpdatedPreloadedTraces()
  const acceptedSnapshot = structuredClone({
    newRoutes: acceptedNewRoutes,
    preloads: acceptedPreloads,
    originalSrj,
    connectivity: {
      netMap: callerConnMap.netMap,
      idToNetMap: callerConnMap.idToNetMap,
    },
  })
  const next = new Pipeline9InheritedDrcRepairSolver({
    ...previousJoint.params,
    newHdRoutes: acceptedNewRoutes,
    updatedPreloadedTraces: acceptedPreloads,
    mutatedPreloadedTraceIds: new Set(
      previousJoint
        .getMutatedPreloadedTraces()
        .map((trace) => trace.pcb_trace_id),
    ),
  })
  expect(next.stats.initialJointDrcIssueCount).toBe(1)
  expect(next.inputNewHdRoutes).not.toBe(acceptedNewRoutes)
  expect(next.inputNewHdRoutes[0]).not.toBe(acceptedNewRoutes[0])
  expect(next.inputUpdatedPreloadedTraces[0]).not.toBe(acceptedPreloads[0])
  expect(next.params.connMap).not.toBe(callerConnMap)
  expect(next.params.connMap.netMap).toEqual(callerConnMap.netMap)
  expect(next.params.connMap.idToNetMap).toEqual(callerConnMap.idToNetMap)
  expect(next.params.connMap.netMap[aliasNet]).toBe(
    next.params.connMap.netMap[primaryNet],
  )
  expect(next.params.connMap.netMap[aliasNet]).not.toBe(
    callerConnMap.netMap[aliasNet],
  )
  const workingRoutes = next.exactRepairSolver!.params.hdRoutes
  const workingNewRoute = workingRoutes.find(
    (route) => route.connectionName === newConnection.name,
  )
  const workingPreload = workingRoutes.find((route) =>
    next.syntheticConnectionNames.has(route.connectionName),
  )
  if (!workingNewRoute || !workingPreload) {
    throw new Error("Expected both new and preloaded speculative routes")
  }
  // Exercise the actual regional search helper that adds splice aliases.
  const regionalRoutes = asRegionalRoutes(
    [workingNewRoute, structuredClone(workingNewRoute)],
    next.params.connMap,
  )
  for (const regionalRoute of regionalRoutes) {
    expect(
      next.params.connMap.areIdsConnected(
        regionalRoute.connectionName,
        newConnection.name,
      ),
    ).toBeTrue()
    expect(
      callerConnMap.getNetConnectedToId(regionalRoute.connectionName),
    ).toBeUndefined()
  }

  // Controlled publication contract, not native replay. Mutate the actual
  // search inputs, then reject a same-pair regression from 0.06 to 0.02 mm.
  workingNewRoute.route[1]!.y = 1
  for (const point of workingPreload.route.slice(1, -1)) point.y = -0.32
  next["publishValidatedOutput"](workingRoutes)

  expect(next.stats.jointOutputRejectedForDrcRegression).toBeTrue()
  expect(next.stats.jointOutputAccepted).toBeFalse()
  expect(next.stats.publishedJointDrcIssueCount).toBe(1)
  expect(next.getOutput()).toBe(acceptedNewRoutes)
  expect(next.getOutput()[0]).toBe(newRoute)
  expect(next.getUpdatedPreloadedTraces()).toBe(acceptedPreloads)
  expect(next.getMutatedPreloadedTraces()).toEqual([preMutatedTrace])
  expect(next.getMutatedPreloadedTraces()[0]).toBe(preMutatedTrace)
  expect({
    newRoutes: acceptedNewRoutes,
    preloads: acceptedPreloads,
    originalSrj,
    connectivity: {
      netMap: callerConnMap.netMap,
      idToNetMap: callerConnMap.idToNetMap,
    },
  }).toEqual(acceptedSnapshot)
  expect(callerConnMap.netMap[aliasNet]).toBe(callerConnMap.netMap[primaryNet])
  expect(callerConnMap.getNetConnectedToId("completed_joint_alias")).toBe(
    primaryNet,
  )
  const retained = evaluateRelaxedDrc({
    inputSrj: originalSrj,
    srjWithPointPairs: originalSrj,
    routedTraces: [
      ...next.getMutatedPreloadedTraces(),
      ...convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: [newConnection],
        originalConnections: originalSrj.connections,
        hdRoutes: next.getOutput(),
        layerCount: originalSrj.layerCount,
        obstacles: originalSrj.obstacles,
        defaultViaHoleDiameter: 0.15,
        connMap: previousJoint.params.connMap,
      }),
    ],
  })
  expect(retained.errors).toHaveLength(1)
  const padError = retained.errors.find(
    (error) => error.type === "pcb_pad_trace_clearance_error",
  )
  if (padError?.type !== "pcb_pad_trace_clearance_error") {
    throw new Error("Expected the joint incumbent's inherited pad finding")
  }
  expect(padError.actual_clearance).toBeCloseTo(0.06)
})
