import { expect, test } from "bun:test"
import { checkPadTraceClearance } from "@tscircuit/checks"
import type { PcbTrace } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson as ForceSimpleRouteJson } from "high-density-repair03/lib"
import {
  getForceScalesForEffort,
  getMaxTargetedCandidateAttemptsForEffort,
  TRACE_PAD_REPAIR_MAX_MOVE,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import {
  applyDrcErrorForces,
  materializeRoutes,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { applyPipeline9PadTraceForce } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9PadTraceForce"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceFamily,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { getPipeline9PadCopperForceTarget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PadCopperForceTarget"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

type ForceAttempt = {
  errorIndex: number
  family: Pipeline9HighDensityForceFamily
  scale: number
  application: number
}
type ForceObservation = ForceAttempt & { route: HighDensityRoute }

test("Pipeline9 endpoint pad slots retain distinct native and rigid candidates within the original budget", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "pad-node",
    startPcbPortId: "A-start",
    endPcbPortId: "A-end",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -4, y: 4, z: 0, pcb_port_id: "A-start" },
      { x: -1, y: 0, z: 0, traceThickness: 0.1 },
      { x: 1, y: 0, z: 0, traceThickness: 0.1 },
      { x: 4, y: 4, z: 0, pcb_port_id: "A-end" },
    ],
    vias: [],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "pad-node",
    center: { x: 0, y: 0 },
    width: 12,
    height: 12,
    availableZ: [0, 1],
    portPoints: [route.route[0]!, route.route.at(-1)!].map((point) => ({
      ...point,
      connectionName: "A",
    })),
  }
  const pad = {
    type: "pcb_smtpad" as const,
    pcb_smtpad_id: "foreign-pad",
    pcb_component_id: "foreign-component",
    pcb_port_id: "foreign-port",
    shape: "rect" as const,
    x: 0,
    y: -0.12,
    width: 0.02,
    height: 0.02,
    layer: "top" as const,
  }
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: pad.x, y: pad.y },
      width: pad.width,
      height: pad.height,
      layers: [pad.layer],
      connectedTo: [pad.pcb_smtpad_id],
    },
  ]
  const connMap = new ConnectivityMap({
    A: ["A", "A_0", "A-start", "A-end"],
    B: [pad.pcb_smtpad_id],
  })
  const traceRouteIndexById = new Map([["A_0", 0]])
  const trace: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "A_0",
    source_trace_id: "A",
    route: route.route.map((point): PcbTrace["route"][number] => ({
      route_type: "wire",
      x: point.x,
      y: point.y,
      width: route.traceThickness,
      layer: "top",
    })),
  }
  // A deliberately large, valid input clearance keeps every capped native
  // and rigid step moving at both tested efforts. No timing assertion is used.
  const minimumClearance = 2
  const officialErrors = checkPadTraceClearance([trace, pad], {
    connMap,
    minClearance: minimumClearance,
  })
  expect(officialErrors).toHaveLength(1)
  // Repeat the official target only to verify the original-error cursor is
  // independent of the number and ordering of private candidate families.
  const errors: Pipeline9DrcError[] = [0, 1].map(() => ({
    ...officialErrors[0]!,
    __pad_ids: [pad.pcb_smtpad_id],
    __pad_copper: [pad],
  }))
  const srj: ForceSimpleRouteJson & { minViaHoleDiameter: number } = {
    bounds: { minX: -6.15, maxX: 6.15, minY: -6.15, maxY: 6.15 },
    connections: [],
    obstacles,
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: minimumClearance,
    minViaEdgeToPadEdgeClearance: minimumClearance,
  }
  const publishReference = (mutable: HighDensityRoute): HighDensityRoute => {
    const materialized = materializeRoutes([mutable])[0]!
    return {
      ...route,
      route: materialized.route.map((point) => ({ ...point })),
      vias: materialized.vias.map((via) => ({ ...via })),
    }
  }
  const original = structuredClone({ route, node, pad, obstacles, errors })
  for (const effort of [1, 2]) {
    const scales = getForceScalesForEffort(effort)
    const maxApplications = getMaxTargetedCandidateAttemptsForEffort(effort)
    expect(
      Math.ceil(maxApplications / 2) *
        TRACE_PAD_REPAIR_MAX_MOVE *
        Math.max(...scales.map(Math.abs)),
    ).toBeLessThan(minimumClearance)
    const attempts: ForceAttempt[] = []
    const attemptedErrors: number[] = []
    const observations: ForceObservation[] = []
    for (const candidates of getPipeline9HighDensityForceCandidates({
      node,
      hdRoutes: [route],
      errors,
      traceRouteIndexById,
      obstacles,
      layerCount: 2,
      viaDiameter: 0.3,
      viaHoleDiameter: 0.15,
      traceWidth: 0.1,
      obstacleMargin: minimumClearance,
      connMap,
      forceContext: { connMap, obstacles },
      effort,
      onErrorAttempted: (errorIndex): void => {
        attemptedErrors.push(errorIndex)
      },
      onCandidateAttempted: (family, scale, application): void => {
        attempts.push({
          errorIndex: attemptedErrors.at(-1)!,
          family,
          scale,
          application,
        })
      },
    })) {
      observations.push({ ...attempts.at(-1)!, route: candidates[0]! })
    }
    expect(attemptedErrors).toEqual([0, 1])
    expect(attempts.length).toBeLessThanOrEqual(
      errors.length * scales.length * maxApplications,
    )
    for (const errorIndex of [0, 1]) {
      const originalSlots = scales.flatMap((scale, scaleIndex) =>
        Array.from(
          { length: maxApplications },
          (_, application): ForceAttempt => ({
            errorIndex,
            family:
              scaleIndex === 2 && application === 0
                ? "pad-wire-0"
                : scaleIndex === 2 && application === 1
                  ? "pad-detour-nearest"
                  : scaleIndex === 2 && application === 2
                    ? "pad-wire-1"
                    : scaleIndex === 2 && application === 3
                      ? "pad-detour-opposite"
                      : application % 2 === 0
                        ? "pad-wire"
                        : "native",
            scale,
            application,
          }),
        ),
      ).filter(
        (attempt) => attempt.scale !== -1 || attempt.family !== "native",
      )
      expect(
        attempts.filter((attempt) => attempt.errorIndex === errorIndex),
      ).toEqual(originalSlots)
    }
    const expectedNative: ForceObservation[] = []
    const expectedRigid: ForceObservation[] = []
    for (const [errorIndex, error] of errors.entries()) {
      for (const scale of scales) {
        // Reconstruct the original unsplit schedule using the actual operators,
        // not the modified generator. Families start from separate incumbents.
        const referenceRoutes = new Map<string, HighDensityRoute>(
          ["native", "pad-wire"].map((family): [string, HighDensityRoute] => [
            family,
            {
              ...structuredClone(route),
              connectionName: "A_0",
              rootConnectionName: "A_0",
            },
          ]),
        )
        for (
          let application = 0;
          application < maxApplications;
          application++
        ) {
          const family = application % 2 === 0 ? "pad-wire" : "native"
          const mutable = referenceRoutes.get(family)!
          const target = getPipeline9PadCopperForceTarget({
            pad,
            route: mutable,
            obstacles,
            layerCount: 2,
          })
          if (!target) {
            throw new Error("Reference pad target must remain available")
          }
          const changed =
            family === "pad-wire"
              ? applyPipeline9PadTraceForce({
                  route: mutable,
                  target,
                  protectedPointIndexes: new Set([0, 3]),
                  minimumClearance,
                  scale,
                })
              : applyDrcErrorForces(
                  { ...srj, obstacles: target.obstacles },
                  [mutable],
                  [{ ...error, pcb_trace_id: "A_0", center: target.center }],
                  traceRouteIndexById,
                  scale,
                  connMap,
                  true,
                  false,
                  false,
                  false,
                )
          expect(changed).toBe(true)
          const destination =
            family === "native" ? expectedNative : expectedRigid
          destination.push({
            errorIndex,
            family,
            scale,
            application,
            route: publishReference(mutable),
          })
        }
      }
    }
    // The positive native chains remain byte-for-byte identical. Typed pad
    // -1 duplicates now fund at most two detours; no distinct native geometry
    // is lost, and the endpoint and rigid slots keep their original identities.
    const native = observations.filter((item) => item.family === "native")
    expect(native).toEqual(expectedNative.filter((item) => item.scale !== -1))
    for (const oldCandidate of expectedNative) {
      expect(native.map((item) => item.route)).toContainEqual(oldCandidate.route)
    }
    const rigid = observations.filter((item) => item.family === "pad-wire")
    for (const scale of [1, 1.75]) {
      expect(rigid.filter((item) => item.scale === scale)).toEqual(
        expectedRigid.filter((item) => item.scale === scale),
      )
    }
    const actualRigidRoutes = rigid.map((item) => item.route)
    for (const oldCandidate of expectedRigid) {
      expect(actualRigidRoutes).toContainEqual(oldCandidate.route)
    }
    for (const errorIndex of [0, 1]) {
      expect(
        expectedRigid
          .filter((item) => item.errorIndex === errorIndex && item.scale === -1)
          .map((item) => item.route),
      ).toEqual(
        expectedRigid
          .filter((item) => item.errorIndex === errorIndex && item.scale === 1)
          .map((item) => item.route),
      )
    }
    for (const family of ["pad-wire-0", "pad-wire-1"] as const) {
      const endpointCandidates = observations.filter(
        (item) => item.family === family,
      )
      expect(endpointCandidates).toHaveLength(errors.length)
      for (const candidate of endpointCandidates) {
        const heldIndex = family === "pad-wire-0" ? 2 : 1
        expect(candidate.route.route[heldIndex]).toEqual(route.route[heldIndex])
      }
    }
    for (const candidate of observations) {
      expect(candidate.route.route[0]).toEqual(route.route[0])
      expect(candidate.route.route.at(-1)).toEqual(route.route.at(-1))
      expect(candidate.route.vias).toEqual(route.vias)
    }
  }
  expect({ route, node, pad, obstacles, errors }).toEqual(original)
})
