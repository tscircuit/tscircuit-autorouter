import { expect, test } from "bun:test"
import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkSameNetViaSpacing,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import type { AnyCircuitElement, PcbPort, PcbTrace } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  createPipeline9HighDensityDrcCandidateGate,
  type Pipeline9HighDensityDrcSnapshot,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcCandidateGate"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { RELAXED_TRACE_CLEARANCE } from "lib/testing/drcPresets"
import { MIN_VIA_TO_VIA_CLEARANCE } from "lib/testing/getDrcErrors"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 scoped copper preserves native endpoint inference, pair contact and error order", (): void => {
  const signal: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "signal",
    route: [-1, 0, 1].map((x): PcbTrace["route"][number] => ({
      route_type: "wire" as const,
      x,
      y: 0,
      layer: "top" as const,
      width: 0.1,
    })),
  }
  const contact: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "contact",
    // The first segment has positive via clearance; a later segment touches
    // the same via. The typed pair error must be suppressed in its entirety.
    route: [
      { x: -1, y: 0.53 },
      { x: 1, y: 0.53 },
      { x: 1, y: 0.13 },
      { x: -1, y: 0.13 },
    ].map((point): PcbTrace["route"][number] => ({
      ...point,
      route_type: "wire" as const,
      layer: "top" as const,
      width: 0.1,
    })),
  }
  const currentBoard: AnyCircuitElement[] = [
    ...["start", "end"].map((name, index): PcbPort => ({
      type: "pcb_port" as const,
      pcb_port_id: `port-${name}`,
      source_port_id: `source-${name}`,
      x: index === 0 ? -1 : 1,
      y: 0,
      layers: ["top" as const],
    })),
    signal,
    {
      type: "pcb_via",
      pcb_via_id: "via",
      x: 0,
      y: 0.28,
      layers: ["top"],
      outer_diameter: 0.3,
      hole_diameter: 0.15,
    },
    contact,
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pad",
      shape: "circle",
      x: 0,
      y: -0.22,
      radius: 0.1,
      layer: "top",
    },
  ]
  const candidateBoard = currentBoard.map((element): AnyCircuitElement => {
    if (element !== signal) return element
    return {
      ...signal,
      route: signal.route.map(
        (point, index): PcbTrace["route"][number] => ({
          ...point,
          ...(index === 1 ? { y: -0.04 } : {}),
        }),
      ),
    }
  })
  const currentRoutes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]
  const candidateRoutes = currentRoutes.map(
    (route): HighDensityRoute => ({
      ...route,
      route: route.route.map(
        (point, index): HighDensityRoute["route"][number] => ({
          ...point,
          y: index === 1 ? -0.04 : point.y,
        }),
      ),
    }),
  )
  const connMap = new ConnectivityMap({
    signalNet: ["signal", "port-start", "port-end"],
    contactNet: ["contact"],
    viaNet: ["via"],
    padNet: ["pad"],
  })
  const snapshots = new Map<
    HighDensityRoute[],
    Pipeline9HighDensityDrcSnapshot
  >([
    [
      currentRoutes,
      {
        circuitJson: currentBoard,
        connMap,
        normalizeErrors: (errors): Pipeline9DrcError[] => errors,
      },
    ],
    [
      candidateRoutes,
      {
        circuitJson: candidateBoard,
        connMap,
        normalizeErrors: (errors): Pipeline9DrcError[] => errors,
      },
    ],
  ])
  const gate = createPipeline9HighDensityDrcCandidateGate({
    getSnapshot: (routes): Pipeline9HighDensityDrcSnapshot => {
      const snapshot = snapshots.get(routes)
      if (snapshot === undefined) {
        throw new Error("The fixture requires a declared board snapshot")
      }
      return snapshot
    },
  })
  const nativeErrors = (board: AnyCircuitElement[]): Pipeline9DrcError[] => {
    const circuitJson = structuredClone(board)
    const traceOptions = { connMap, minClearance: RELAXED_TRACE_CLEARANCE }
    const viaOptions = { connMap, minClearance: MIN_VIA_TO_VIA_CLEARANCE }
    const overlapErrors = checkEachPcbTraceNonOverlapping(
      circuitJson,
      traceOptions,
    )
    const inferredSignal = circuitJson.find(
      (element): element is PcbTrace =>
        element.type === "pcb_trace" && element.pcb_trace_id === "signal",
    )!
    expect(inferredSignal.route[0]).toMatchObject({
      start_pcb_port_id: "port-start",
    })
    expect(inferredSignal.route.at(-1)).toMatchObject({
      end_pcb_port_id: "port-end",
    })
    return [
      ...overlapErrors,
      ...checkViaTraceClearance(circuitJson, traceOptions),
      ...checkPadTraceClearance(circuitJson, traceOptions),
      ...checkSameNetViaSpacing(circuitJson, viaOptions),
      ...checkDifferentNetViaSpacing(circuitJson, viaOptions),
    ] as unknown as Pipeline9DrcError[]
  }
  const originalBoards = structuredClone([currentBoard, candidateBoard])
  const expectedCurrent = nativeErrors(currentBoard)
  const expectedCandidate = nativeErrors(candidateBoard)
  const typedViaErrors = expectedCurrent.filter(
    (error): boolean => error.type === "pcb_via_trace_clearance_error",
  )
  expect(
    typedViaErrors.map((error): unknown => error.pcb_trace_id),
  ).toEqual(["signal"])
  expect(typedViaErrors[0]!.message).toContain("port-start")
  // Repeat through the cached incumbent path as well as the first evaluation.
  for (let evaluation = 0; evaluation < 2; evaluation++) {
    const actual = gate({
      currentRoutes,
      candidateRoutes,
      changedTraceIds: new Set(["signal"]),
    })
    expect(actual.candidateErrorPairsAreUnambiguous).toBeTrue()
    expect(actual.currentErrors).toEqual(expectedCurrent)
    expect(actual.candidateErrors).toEqual(expectedCandidate)
    expect([currentBoard, candidateBoard]).toEqual(originalBoards)
  }
})
