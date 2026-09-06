import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbSmtPad, PcbTrace } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson as ForceSimpleRouteJson } from "high-density-repair03/lib"
import {
  getForceScalesForEffort,
  getMaxTargetedCandidateAttemptsForEffort,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import {
  applyDrcErrorForces,
  materializeRoutes,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import {
  applyPipeline9PadTraceForce,
  getPipeline9PadTraceForceMobility,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9PadTraceForce"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceFamily,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { getPipeline9PadCopperForceTarget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PadCopperForceTarget"
import { isPipeline9HighDensityRouteInsideBounds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityRouteInsideBounds"
import { addAutoroutingViaTraceIds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { normalizePipeline9DrcErrorsForRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalizePipeline9DrcErrorsForRepair"
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
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"
import captured from "../fixtures/srj18-sample12-pad397-copper.json"

type ForceAttempt = {
  family: Pipeline9HighDensityForceFamily
  scale: number
  application: number
}

type ForceObservation = {
  attempt: ForceAttempt
  routes: HighDensityRoute[]
}

test("captured sample12 copper exposes the pad repair's clean via-owner dependency", (): void => {
  // Hosted 941f696f, sample12, node pass56: only net13's pad397 error is
  // initially present. The clean foreign via owner is another cmn244 fragment.
  // This is a captured copper neighbourhood, not a second pipeline solve.
  const route: HighDensityRoute = structuredClone(captured.targetHdRoute)
  const owner: HighDensityRoute = structuredClone(captured.ownerHdRoute)
  const pad = captured.pad as Extract<PcbSmtPad, { shape: "rect" }>
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
        connected_source_port_ids: captured.ownerConnection.pointsToConnect.map(
          (point: { pcb_port_id: string }): string => point.pcb_port_id,
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
    pad: { ...pad },
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
  // Effort 2 uses the native family's existing longer cumulative sequence;
  // this probe does not alter production budgets or infer DRC-clean success.
  const configurations = [
    { includeOwner: false, effort: 1 },
    { includeOwner: true, effort: 1 },
    { includeOwner: true, effort: 2 },
  ]
  const baselineByEffort = new Map<number, ForceObservation[]>()
  let firstNativePair: HighDensityRoute[] | undefined
  for (const { includeOwner, effort } of configurations) {
    const attempts: ForceAttempt[] = []
    const observations: ForceObservation[] = []
    if (includeOwner) baselineByEffort.set(effort, observations)
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
      effort,
      onCandidateAttempted: (family, scale, application): void => {
        attempts.push({ family, scale, application })
      },
      onCandidateRejected: (reason): void => {
        rejected[reason] = (rejected[reason] ?? 0) + 1
      },
    })) {
      const attempt = attempts.at(-1)!
      observations.push({ attempt: { ...attempt }, routes: candidate })
      if (attempt.family !== "native") continue
      if (includeOwner && effort === 1 && firstNativePair === undefined) {
        firstNativePair = structuredClone(candidate)
      }
      nativeCandidates++
      const candidateOwner = includeOwner ? candidate[1]! : owner
      const candidateOwnerTrace = serialize(candidateOwner, ownerTrace)
      console.info(
        JSON.stringify({
          diagnostic: "sample12-pad397-captured-native-scope",
          scope: includeOwner ? "target-and-owner" : "target-only",
          effort,
          scale: attempt.scale,
          application: attempt.application,
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
    expect(attempts.map((attempt) => attempt.family)).toContain("native")
    console.info(
      JSON.stringify({
        diagnostic: "sample12-pad397-captured-native-scope-summary",
        scope: includeOwner ? "target-and-owner" : "target-only",
        effort,
        nativeCandidates,
        rejected,
      }),
    )
  }
  if (!firstNativePair) {
    throw new Error("The captured probe requires its published native pair")
  }
  const originalNativePair = firstNativePair
  const traceIds = [targetTrace.pcb_trace_id, ownerTrace.pcb_trace_id]
  const traceRouteIndexById = new Map(
    traceIds.map((traceId, index): [string, number] => [traceId, index]),
  )
  const nodeBounds = getBoundsFromNodeWithPortPoints(node)
  const copperRadius = captured.reportedVia.outer_diameter / 2
  const forceSrj: ForceSimpleRouteJson & { minViaHoleDiameter: number } = {
    bounds: {
      minX: nodeBounds.minX - copperRadius,
      maxX: nodeBounds.maxX + copperRadius,
      minY: nodeBounds.minY - copperRadius,
      maxY: nodeBounds.maxY + copperRadius,
    },
    connections: [],
    obstacles,
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.15,
    minViaEdgeToPadEdgeClearance: 0.15,
  }
  const mutable = structuredClone(originalNativePair).map(
    (fragment, index): HighDensityRoute => ({
      ...fragment,
      connectionName: traceIds[index]!,
      rootConnectionName: traceIds[index]!,
    }),
  )
  let refreshedCandidates = originalNativePair
  const maximumNativeCalls = getMaxTargetedCandidateAttemptsForEffort(1)
  expect(maximumNativeCalls).toBe(3)
  // The first call is the real published native candidate above. Re-evaluate
  // all actual errors before each of the remaining two calls; no extra budget,
  // hand-written error, accepted intermediate geometry, or outcome assumption.
  for (let nativeCall = 1; nativeCall < maximumNativeCalls; nativeCall++) {
    const currentCircuitJson = getCircuitJson(
      refreshedCandidates[0]!,
      refreshedCandidates[1]!,
    )
    const fresh = evaluate(refreshedCandidates[0]!, refreshedCandidates[1]!)
    // errorsWithCenters locates typed via errors at the actual physical via.
    // Use the same exact-ID via enrichment and primary normalization as HD.
    const freshErrors = normalizePipeline9DrcErrorsForRepair({
      errors: addAutoroutingViaTraceIds({
        errors: fresh.errorsWithCenters.map((error) => ({ ...error })),
        circuitJson: currentCircuitJson,
        evaluatedTraceIds: new Set(traceIds),
      }),
      circuitJson: currentCircuitJson,
      newTraceIds: new Set(traceIds),
    })
    let forceObstacles = obstacles
    const freshForceErrors = freshErrors.map((error): Pipeline9DrcError => {
      const routeIndex =
        typeof error.pcb_trace_id === "string"
          ? traceRouteIndexById.get(error.pcb_trace_id)
          : undefined
      const isCapturedPadError =
        error.pcb_pad_id === pad.pcb_smtpad_id ||
        error.pcb_trace_error_id ===
          `overlap_${error.pcb_trace_id}_${pad.pcb_smtpad_id}`
      const padTarget =
        isCapturedPadError && routeIndex !== undefined
          ? getPipeline9PadCopperForceTarget({
              pad: { ...pad },
              route: mutable[routeIndex]!,
              obstacles,
              layerCount: 4,
            })
          : undefined
      if (isCapturedPadError && !padTarget) {
        throw new Error("A fresh captured pad error requires its exact target")
      }
      if (!padTarget) return error
      forceObstacles = padTarget.obstacles
      return { ...error, center: padTarget.center }
    })
    const changed = applyDrcErrorForces(
      { ...forceSrj, obstacles: forceObstacles },
      mutable,
      freshForceErrors,
      traceRouteIndexById,
      1,
      connMap,
      true,
      false,
      false,
      false,
    )
    refreshedCandidates = materializeRoutes(mutable).map(
      (fragment, index): HighDensityRoute => ({
        ...originalNativePair[index]!,
        route: fragment.route.map((point) => ({ ...point })),
        vias: fragment.vias.map((via) => ({ ...via })),
      }),
    )
    const anchorsPreserved = refreshedCandidates.every(
      (fragment, index): boolean => {
        const input = originalNativePair[index]!
        return (
          JSON.stringify(fragment.route[0]) ===
            JSON.stringify(input.route[0]) &&
          JSON.stringify(fragment.route.at(-1)) ===
            JSON.stringify(input.route.at(-1))
        )
      },
    )
    const insideBounds = refreshedCandidates.every((fragment, index) =>
      isPipeline9HighDensityRouteInsideBounds(fragment, nodeBounds, 4, {
        originalRoute: originalNativePair[index]!,
        node,
      }),
    )
    console.info(
      JSON.stringify({
        diagnostic: "sample12-pad397-captured-fresh-error-continuation",
        nativeCall,
        maximumNativeCalls,
        changed,
        anchorsPreserved,
        insideBounds,
        inputErrors: freshErrors,
        targetPoints: refreshedCandidates[0]!.route.slice(1, 5),
        ownerVias: serialize(refreshedCandidates[1]!, ownerTrace).route.filter(
          (point) => point.route_type === "via",
        ),
        errors: evaluate(refreshedCandidates[0]!, refreshedCandidates[1]!)
          .errors,
      }),
    )
    if (!changed || !anchorsPreserved || !insideBounds) break
  }
  for (const effort of [1, 2]) {
    const attempts: ForceAttempt[] = []
    const observations: ForceObservation[] = []
    const feedbackResults: Pipeline9DrcError[][] = []
    const iterator = getPipeline9HighDensityForceCandidates({
      node,
      hdRoutes: [route, owner],
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
      effort,
      onCandidateAttempted: (family, scale, application): void => {
        attempts.push({ family, scale, application })
      },
    })
    let next = iterator.next()
    while (!next.done) {
      const candidates = next.value
      const attempt = attempts.at(-1)!
      observations.push({ attempt: { ...attempt }, routes: candidates })
      const currentCircuitJson = getCircuitJson(candidates[0]!, candidates[1]!)
      const checked = evaluate(candidates[0]!, candidates[1]!)
      const feedbackErrors = normalizePipeline9DrcErrorsForRepair({
        errors: addAutoroutingViaTraceIds({
          errors: checked.errorsWithCenters.map((error) => ({ ...error })),
          circuitJson: currentCircuitJson,
          evaluatedTraceIds: new Set(traceIds),
        }),
        circuitJson: currentCircuitJson,
        newTraceIds: new Set(traceIds),
      }).map((error): Pipeline9DrcError => {
        if (
          error.pcb_pad_id !== pad.pcb_smtpad_id &&
          error.pcb_trace_error_id !==
            `overlap_${error.pcb_trace_id}_${pad.pcb_smtpad_id}`
        ) {
          return error
        }
        return {
          ...error,
          __pad_ids: [pad.pcb_smtpad_id],
          __pad_centers: [{ x: pad.x, y: pad.y }],
          __pad_copper: [structuredClone(pad)],
        }
      })
      if (attempt.family === "native-feedback") {
        feedbackResults.push(checked.errors.map((error) => ({ ...error })))
        console.info(
          JSON.stringify({
            diagnostic: "sample12-pad397-integrated-native-feedback",
            effort,
            reservedSlotScale: attempt.scale,
            application: attempt.application,
            errors: checked.errors,
            targetPoints: candidates[0]!.route.slice(1, 5),
            ownerVias: serialize(candidates[1]!, ownerTrace).route.filter(
              (point) => point.route_type === "via",
            ),
          }),
        )
      }
      for (const [index, fragment] of candidates.entries()) {
        const input = index === 0 ? route : owner
        expect(fragment.route[0]).toEqual(input.route[0])
        expect(fragment.route.at(-1)).toEqual(input.route.at(-1))
        expect(
          isPipeline9HighDensityRouteInsideBounds(fragment, nodeBounds, 4, {
            originalRoute: input,
            node,
          }),
        ).toBe(true)
      }
      next = iterator.next({ errors: feedbackErrors })
    }
    // Every distinct original positive-scale chain is byte-for-byte retained.
    // Only negative native slots, whose values duplicate +1, may give feedback.
    expect(observations.filter((item) => item.attempt.scale > 0)).toEqual(
      baselineByEffort.get(effort)!.filter((item) => item.attempt.scale > 0),
    )
    expect(attempts.length).toBeLessThanOrEqual(
      getForceScalesForEffort(effort).length *
        getMaxTargetedCandidateAttemptsForEffort(effort),
    )
    expect(feedbackResults.length).toBeGreaterThan(0)
    if (effort === 1) {
      // Hosted 04018 proved this exact first native checkpoint needs only one
      // fresh-error call. The production generator must now expose that repair.
      expect(feedbackResults[0]).toHaveLength(0)
    }
  }
  expect({ route, owner, pad, obstacles }).toEqual(original)
})
