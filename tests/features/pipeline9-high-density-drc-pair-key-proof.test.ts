import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { arePipeline9HighDensityDrcPairIdentifiersUnambiguous } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9HighDensityDrcPairIdentifiersUnambiguous"
import {
  createPipeline9HighDensityDrcCandidateGate,
  type Pipeline9HighDensityDrcSnapshot,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcCandidateGate"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 proves pair-key uniqueness before treating scoped errors as a full-board subset", (): void => {
  const remoteTrace: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "C",
    source_trace_id: "remote-net",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
    ],
  }
  const currentLocalTrace: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "B_C",
    source_trace_id: "local-net",
    route: [
      { route_type: "wire", x: 20, y: -0.2, width: 0.1, layer: "top" },
      { route_type: "wire", x: 21, y: -0.2, width: 0.1, layer: "top" },
    ],
  }
  const candidateLocalTrace: PcbTrace = {
    ...currentLocalTrace,
    route: currentLocalTrace.route.map((point) => ({ ...point, y: 0 })),
  }
  const pads: AnyCircuitElement[] = [
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pad_A_B",
      x: 0.5,
      y: 0.17,
      width: 0.4,
      height: 0.2,
      shape: "rect",
      layer: "top",
    },
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pad_A",
      x: 20.5,
      y: 0.22,
      width: 0.4,
      height: 0.2,
      shape: "rect",
      layer: "top",
    },
  ]
  const currentCircuitJson = [remoteTrace, currentLocalTrace, ...pads]
  const candidateCircuitJson = [remoteTrace, candidateLocalTrace, ...pads]
  const route: HighDensityRoute = {
    connectionName: "B_C",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 20, y: -0.2, z: 0 },
      { x: 21, y: -0.2, z: 0 },
    ],
    vias: [],
  }
  const currentRoutes = [route]
  const candidateRoutes = [
    { ...route, route: route.route.map((point) => ({ ...point, y: 0 })) },
  ]
  const snapshots = new Map<
    HighDensityRoute[],
    Pipeline9HighDensityDrcSnapshot
  >()
  for (const [routes, circuitJson] of [
    [currentRoutes, currentCircuitJson],
    [candidateRoutes, candidateCircuitJson],
  ] as const) {
    snapshots.set(routes, {
      circuitJson,
      connMap: getFullConnectivityMapFromCircuitJson(circuitJson),
      normalizeErrors: (
        errors: Record<string, unknown>[],
      ): Pipeline9DrcError[] => errors,
    })
  }
  const gate = createPipeline9HighDensityDrcCandidateGate({
    getSnapshot: (
      routes: HighDensityRoute[],
    ): Pipeline9HighDensityDrcSnapshot => {
      const snapshot = snapshots.get(routes)
      if (!snapshot) throw new Error("Missing pair-key fixture snapshot")
      return snapshot
    },
  })
  const local = gate({
    currentRoutes,
    candidateRoutes,
    changedTraceIds: new Set(["B_C"]),
  })
  const full = getDrcErrors(structuredClone(candidateCircuitJson), {
    includeTraceContinuity: false,
    includeBoardEdge: false,
    traceClearance: 0.1,
    viaClearance: 0.1,
  })
  // The two different pairs share the official key pad_A_B_C. The stronger
  // remote pair suppresses the local pair only in the complete-board check.
  expect(local.candidateErrorPairsAreUnambiguous).toBe(false)
  expect(local.candidateErrors).toHaveLength(1)
  expect(full.errors).toHaveLength(1)
  expect(local.candidateErrors[0]).toMatchObject({
    pcb_pad_id: "pad_A",
    pcb_trace_id: "B_C",
    pcb_pad_trace_clearance_error_id: "pad_trace_clearance_pad_A_B_C",
  })
  expect(full.errors[0]).toMatchObject({
    pcb_pad_id: "pad_A_B",
    pcb_trace_id: "C",
    pcb_pad_trace_clearance_error_id: "pad_trace_clearance_pad_A_B_C",
  })
  const safeCircuitJson = candidateCircuitJson.map(
    (element): AnyCircuitElement =>
      element.type === "pcb_smtpad" && element.pcb_smtpad_id === "pad_A_B"
        ? { ...element, pcb_smtpad_id: "remote-pad" }
        : element,
  )
  expect(
    arePipeline9HighDensityDrcPairIdentifiersUnambiguous(safeCircuitJson),
  ).toBe(true)
  const safeRoutes = [...candidateRoutes]
  snapshots.set(safeRoutes, {
    circuitJson: safeCircuitJson,
    connMap: getFullConnectivityMapFromCircuitJson(safeCircuitJson),
    normalizeErrors: (errors: Record<string, unknown>[]): Pipeline9DrcError[] =>
      errors,
  })
  expect(
    gate({
      currentRoutes,
      candidateRoutes: safeRoutes,
      changedTraceIds: new Set(["B_C"]),
    }).candidateErrorPairsAreUnambiguous,
  ).toBe(true)
  expect(
    arePipeline9HighDensityDrcPairIdentifiersUnambiguous([
      ...safeCircuitJson,
      { ...remoteTrace, pcb_trace_id: "pad_A" },
    ]),
  ).toBe(false)
  expect(
    arePipeline9HighDensityDrcPairIdentifiersUnambiguous([
      { ...remoteTrace, pcb_trace_id: "wire" },
      { ...remoteTrace, pcb_trace_id: "wire-between" },
      { ...remoteTrace, pcb_trace_id: "wire_suffix" },
    ]),
  ).toBe(false)
})
