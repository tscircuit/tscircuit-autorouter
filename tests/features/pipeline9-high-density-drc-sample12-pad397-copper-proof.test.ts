import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbSmtPad, PcbTrace } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import {
  applyPipeline9PadTraceForce,
  getPipeline9PadTraceForceMobility,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9PadTraceForce"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceFamily,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { getPipeline9PadCopperForceTarget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PadCopperForceTarget"
import {
  getPipeline9DrcErrorTraceIds,
  type Pipeline9DrcError,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { getDrcErrors, type GetDrcErrorsResult } from "lib/testing/getDrcErrors"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import captured from "../fixtures/srj18-sample12-pad397-copper.json"

test("captured sample12 copper exposes the pad repair's clean via-owner dependency", (): void => {
  // Hosted 941f696f, sample12, node pass56: only net13's pad397 error is
  // initially present. The clean foreign via owner is another cmn244 fragment.
  // This is a captured copper neighbourhood, not a second pipeline solve.
  const route: HighDensityRoute = structuredClone(captured.targetHdRoute)
  const owner: HighDensityRoute = structuredClone(captured.ownerHdRoute)
  const pad = captured.pad as PcbSmtPad
  const targetTrace = captured.targetTrace as PcbTrace
  const ownerTrace = captured.ownerTrace as PcbTrace
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: pad.x, y: pad.y },
      width: captured.pad.width,
      height: captured.pad.height,
      layers: [pad.layer],
      connectedTo: [pad.pcb_smtpad_id],
    },
  ]
  const serialize = (
    candidate: HighDensityRoute,
    originalTrace: PcbTrace,
  ): PcbTrace => {
    const serialized = convertHdRouteToSimplifiedRoute(candidate, 4, {
      defaultViaHoleDiameter: captured.reportedVia.hole_diameter,
    })
    const copper = serialized.map((point): PcbTrace["route"][number] => {
      if (point.route_type === "wire") {
        return point as PcbTrace["route"][number]
      }
      if (point.route_type !== "via") {
        throw new Error("Captured copper contains only wire and via geometry")
      }
      // Match convertToCircuitJson: dimensions belong to pcb_via elements,
      // not the trace's layer-transition route point.
      return {
        route_type: "via",
        x: point.x,
        y: point.y,
        from_layer: point.from_layer,
        to_layer: point.to_layer,
      } as PcbTrace["route"][number]
    })
    return { ...originalTrace, route: copper }
  }
  const getCircuitJson = (
    candidate: HighDensityRoute,
    candidateOwner: HighDensityRoute,
  ): AnyCircuitElement[] => {
    const serializedOwner = serialize(candidateOwner, ownerTrace)
    const ownerVias = serializedOwner.route.filter(
      (point) => point.route_type === "via",
    )
    // Native pad forces preserve the two ordered layer transitions. The
    // captured via19 is the second, not the rounded owner.vias entry.
    expect(ownerVias).toHaveLength(2)
    const viaPoint = ownerVias[1]!
    if (viaPoint.route_type !== "via") {
      throw new Error("Captured owner requires its second via transition")
    }
    return [
      {
        type: "source_trace",
        source_trace_id: captured.ownerConnection.source_trace_id,
        // These exact real ports come from the original dataset connection.
        // Preserve pad-to-owner connectivity without inventing endpoint tags.
        connected_source_port_ids:
          captured.ownerConnection.pointsToConnect.map(
            (point): string => point.pcb_port_id,
          ),
      },
      serialize(candidate, targetTrace),
      serializedOwner,
      pad,
      {
        ...captured.reportedVia,
        type: "pcb_via",
        layers: [...captured.reportedVia.layers] as ["top", "inner1"],
        x: viaPoint.x,
        y: viaPoint.y,
      },
    ]
  }
  const evaluate = (
    candidate: HighDensityRoute,
    candidateOwner: HighDensityRoute = owner,
  ): GetDrcErrorsResult => {
    return getDrcErrors(
      structuredClone(getCircuitJson(candidate, candidateOwner)),
      {
        includeTraceContinuity: false,
        includeBoardEdge: false,
        traceClearance: 0.1,
        viaClearance: 0.1,
      },
    )
  }
  const original = structuredClone({ route, owner, pad, obstacles })
  expect(serialize(route, targetTrace)).toEqual(targetTrace)
  expect(serialize(owner, ownerTrace)).toEqual(ownerTrace)
  const initialErrors = evaluate(route).errors
  expect(initialErrors).toHaveLength(1)
  expect(initialErrors[0]).toMatchObject({
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: targetTrace.pcb_trace_id,
    pcb_pad_id: pad.pcb_smtpad_id,
    actual_clearance: captured.initialError.actual_clearance,
  })
  expect(
    initialErrors.flatMap((error) =>
      getPipeline9DrcErrorTraceIds(error as unknown as Pipeline9DrcError),
    ),
  ).not.toContain(ownerTrace.pcb_trace_id)
  const target = getPipeline9PadCopperForceTarget({
    pad,
    route,
    obstacles,
    layerCount: 4,
  })
  if (!target) throw new Error("Captured pad397 requires its copper witness")
  expect(target.segmentIndex).toBe(2)
  const rigid = structuredClone(route)
  expect(
    applyPipeline9PadTraceForce({
      route: rigid,
      target,
      protectedPointIndexes: new Set(),
      minimumClearance: captured.initialError.minimum_clearance,
      scale: 1,
    }),
  ).toBe(true)
  expect(rigid).toEqual(captured.rigidHdRoute)
  const rigidErrors = evaluate(rigid).errors
  expect(rigidErrors).toHaveLength(1)
  expect(rigidErrors[0]).toMatchObject({
    type: "pcb_via_trace_clearance_error",
    pcb_trace_id: targetTrace.pcb_trace_id,
    pcb_via_id: captured.reportedVia.pcb_via_id,
    actual_clearance: captured.rigidError.actual_clearance,
  })
  const oneEndpoint = structuredClone(route)
  const heldFarPoint = new Set([3])
  expect(
    getPipeline9PadTraceForceMobility({
      route: oneEndpoint,
      target,
      protectedPointIndexes: heldFarPoint,
    }).pointIndexes,
  ).toEqual([2])
  expect(
    applyPipeline9PadTraceForce({
      route: oneEndpoint,
      target,
      protectedPointIndexes: heldFarPoint,
      minimumClearance: captured.initialError.minimum_clearance,
      scale: 1,
    }),
  ).toBe(true)
  const oneEndpointErrors = evaluate(oneEndpoint).errors
  console.info(
    JSON.stringify({
      diagnostic: "sample12-pad397-captured-one-endpoint",
      movedPoint: oneEndpoint.route[2],
      heldPoint: oneEndpoint.route[3],
      via: captured.reportedVia,
      errors: oneEndpointErrors,
    }),
  )
  // Do not infer DRC-clean success from the separate synthetic mechanism test.
  expect(oneEndpoint.route[3]).toEqual(route.route[3])
  for (const candidate of [rigid, oneEndpoint]) {
    expect(candidate.route[0]).toEqual(route.route[0])
    expect(candidate.route.at(-1)).toEqual(route.route.at(-1))
    expect(candidate.vias).toEqual(route.vias)
  }
  const connMap = getFullConnectivityMapFromCircuitJson(
    getCircuitJson(route, owner),
  )
  connMap.addConnections([
    [captured.reportedVia.pcb_via_id, ownerTrace.pcb_trace_id],
  ])
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_244",
    center: { x: 14.726999499999998, y: 10.785000499999999 },
    width: 4.099998999999997,
    height: 2.0699989999999993,
    availableZ: [0, 1, 2, 3],
    // Actual captured seam identities; no fabricated PCB terminal identities.
    portPoints: [route, owner].flatMap((fragment) => [
      { ...fragment.route[0]!, connectionName: fragment.connectionName },
      { ...fragment.route.at(-1)!, connectionName: fragment.connectionName },
    ]),
  }
  const forceError: Pipeline9DrcError = {
    ...initialErrors[0],
    __pad_ids: [pad.pcb_smtpad_id],
    __pad_centers: [{ x: pad.x, y: pad.y }],
    __pad_copper: [structuredClone(pad)],
  }
  for (const includeOwner of [false, true]) {
    const attempts: Pipeline9HighDensityForceFamily[] = []
    let nativeCandidates = 0
    const rejected: Record<string, number> = {}
    const traceRouteIndexById = new Map([[targetTrace.pcb_trace_id, 0]])
    if (includeOwner) traceRouteIndexById.set(ownerTrace.pcb_trace_id, 1)
    for (const candidate of getPipeline9HighDensityForceCandidates({
      node,
      hdRoutes: includeOwner ? [route, owner] : [route],
      errors: [forceError],
      traceRouteIndexById,
      obstacles,
      layerCount: 4,
      viaDiameter: 0.3,
      viaHoleDiameter: 0.15,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      connMap,
      forceContext: { connMap, obstacles },
      effort: 1,
      onCandidateAttempted: (family): void => {
        attempts.push(family)
      },
      onCandidateRejected: (reason): void => {
        rejected[reason] = (rejected[reason] ?? 0) + 1
      },
    })) {
      if (attempts.at(-1) !== "native") continue
      nativeCandidates++
      const candidateOwner = includeOwner ? candidate[1]! : owner
      const candidateOwnerTrace = serialize(candidateOwner, ownerTrace)
      console.info(
        JSON.stringify({
          diagnostic: "sample12-pad397-captured-native-scope",
          scope: includeOwner ? "target-and-owner" : "target-only",
          nativeCandidateIndex: nativeCandidates - 1,
          ownerCopperChanged:
            JSON.stringify(candidateOwnerTrace) !== JSON.stringify(ownerTrace),
          targetPoints: candidate[0]!.route.slice(1, 5),
          ownerVias: candidateOwnerTrace.route.filter(
            (point) => point.route_type === "via",
          ),
          errors: evaluate(candidate[0]!, candidateOwner).errors,
        }),
      )
      for (const [index, fragment] of candidate.entries()) {
        const input = index === 0 ? route : owner
        expect(fragment.route[0]).toEqual(input.route[0])
        expect(fragment.route.at(-1)).toEqual(input.route.at(-1))
      }
    }
    expect(attempts).toContain("native")
    console.info(
      JSON.stringify({
        diagnostic: "sample12-pad397-captured-native-scope-summary",
        scope: includeOwner ? "target-and-owner" : "target-only",
        nativeCandidates,
        rejected,
      }),
    )
  }
  expect({ route, owner, pad, obstacles }).toEqual(original)
})
