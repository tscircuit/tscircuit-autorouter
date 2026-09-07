import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import {
  getForceScalesForEffort,
  getMaxTargetedCandidateAttemptsForEffort,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceFamily,
  type Pipeline9HighDensityForceFeedback,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

type ForceAttempt = {
  family: Pipeline9HighDensityForceFamily
  scale: number
  application: number
}
type ForceObservation = ForceAttempt & {
  route: HighDensityRoute
  errors: Pipeline9DrcError[]
}
type ForceRun = {
  attempts: ForceAttempt[]
  observations: ForceObservation[]
  attemptedErrors: number[]
}

test("Pipeline9 uses only duplicate pad-native slots for independent detours and preserves feedback precedence", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "detour-budget-node",
    startPcbPortId: "A-start",
    endPcbPortId: "A-end",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -4, y: 0, z: 0, pcb_port_id: "A-start" },
      { x: 4, y: 0, z: 0, pcb_port_id: "A-end" },
    ],
    vias: [],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: route.regionId!,
    center: { x: 0, y: 0 },
    width: 10,
    height: 4,
    availableZ: [0, 1],
    portPoints: route.route.map((point) => ({ ...point, connectionName: "A" })),
  }
  const pad = {
    type: "pcb_smtpad" as const,
    pcb_smtpad_id: "foreign-pad",
    pcb_component_id: "foreign-component",
    pcb_port_id: "foreign-port",
    shape: "rect" as const,
    x: 0,
    y: 0.17,
    width: 0.2,
    height: 0.1,
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
  const getCircuitJson = (candidate: HighDensityRoute): AnyCircuitElement[] => {
    const trace: PcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: "A_0",
      source_trace_id: "A",
      route: candidate.route.map((point, index): PcbTrace["route"][number] => ({
        route_type: "wire",
        x: point.x,
        y: point.y,
        width: point.traceThickness ?? candidate.traceThickness,
        layer: "top",
        start_pcb_port_id: index === 0 ? candidate.startPcbPortId : undefined,
        end_pcb_port_id:
          index === candidate.route.length - 1
            ? candidate.endPcbPortId
            : undefined,
      })),
    }
    return structuredClone([trace, pad])
  }
  const options = {
    includeTraceContinuity: false,
    includeBoardEdge: false,
    traceClearance: 0.1,
    viaClearance: 0.1,
  }
  const circuitJson = getCircuitJson(route)
  const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
  const initialErrors = getDrcErrors(circuitJson, options).errors
  expect(initialErrors).toHaveLength(1)
  expect(initialErrors[0]!.type).toBe("pcb_pad_trace_clearance_error")
  const errors: Pipeline9DrcError[] = initialErrors.map((error) => ({
    ...error,
    __pad_ids: [pad.pcb_smtpad_id],
    __pad_copper: [pad],
  }))
  const original = structuredClone({ route, node, pad, obstacles, errors })
  for (const effort of [1, 2]) {
    const runs: ForceRun[] = []
    for (const sendOfficialFeedback of [false, true]) {
      const run: ForceRun = {
        attempts: [],
        observations: [],
        attemptedErrors: [],
      }
      const generator = getPipeline9HighDensityForceCandidates({
        node,
        hdRoutes: [route],
        errors,
        traceRouteIndexById: new Map([["A_0", 0]]),
        obstacles,
        layerCount: 2,
        viaDiameter: 0.3,
        viaHoleDiameter: 0.15,
        traceWidth: 0.1,
        obstacleMargin: 0.15,
        connMap,
        forceContext: { connMap, obstacles },
        effort,
        onErrorAttempted: (errorIndex): void => {
          run.attemptedErrors.push(errorIndex)
        },
        onCandidateAttempted: (family, scale, application): void => {
          run.attempts.push({ family, scale, application })
        },
      })
      let feedback: Pipeline9HighDensityForceFeedback
      while (true) {
        const candidate = generator.next(feedback)
        if (candidate.done) break
        const candidateRoute = candidate.value[0]!
        const candidateErrors: Pipeline9DrcError[] = getDrcErrors(
          getCircuitJson(candidateRoute),
          options,
        ).errors.map((error): Pipeline9DrcError => ({ ...error }))
        // This fixture's native bypass is already clean. Supplying its actual
        // empty official snapshot must reserve feedback's duplicate slots;
        // a no-motion continuation may not silently donate them to detours.
        expect(candidateErrors).toEqual([])
        run.observations.push({
          ...run.attempts.at(-1)!,
          route: candidateRoute,
          errors: candidateErrors,
        })
        feedback = sendOfficialFeedback
          ? { errors: candidateErrors }
          : undefined
      }
      expect(run.attemptedErrors).toEqual([0])
      expect(run.attempts.length).toBeLessThanOrEqual(
        getForceScalesForEffort(effort).length *
          getMaxTargetedCandidateAttemptsForEffort(effort),
      )
      runs.push(run)
    }
    const ordinary = runs[0]!
    const withFeedback = runs[1]!
    expect(
      withFeedback.attempts.filter((attempt) => attempt.scale !== -1),
    ).toEqual(ordinary.attempts.filter((attempt) => attempt.scale !== -1))
    expect(
      withFeedback.observations.filter((candidate) => candidate.scale !== -1),
    ).toEqual(
      ordinary.observations.filter((candidate) => candidate.scale !== -1),
    )
    expect(ordinary.attempts.filter((attempt) => attempt.scale === -1)).toEqual(
      [
        { family: "pad-detour-nearest", scale: -1, application: 0 },
        { family: "pad-detour-opposite", scale: -1, application: 1 },
      ],
    )
    expect(
      withFeedback.attempts.filter((attempt) => attempt.scale === -1),
    ).toEqual([{ family: "native-feedback", scale: -1, application: 0 }])
    const detours = ordinary.observations.filter((candidate) =>
      candidate.family.startsWith("pad-detour-"),
    )
    expect(detours).toHaveLength(2)
    for (const detour of detours) {
      expect(detour.route.route).toHaveLength(route.route.length + 4)
      expect(detour.route.route[0]).toEqual(route.route[0])
      expect(detour.route.route.at(-1)).toEqual(route.route.at(-1))
      expect(detour.route.vias).toEqual(route.vias)
    }
    expect(detours[0]!.route.route[2]!.y).toBeLessThan(0)
    expect(detours[1]!.route.route[2]!.y).toBeGreaterThan(pad.y)
    expect(
      withFeedback.observations.some((candidate) =>
        candidate.family.startsWith("pad-detour-"),
      ),
    ).toBe(false)
  }
  expect({ route, node, pad, obstacles, errors }).toEqual(original)
})
