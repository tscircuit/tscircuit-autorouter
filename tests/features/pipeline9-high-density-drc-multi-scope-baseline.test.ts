import { expect, test } from "bun:test"
import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkSameNetViaSpacing,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  createPipeline9HighDensityDrcCandidateGate,
  type Pipeline9HighDensityDrcSnapshot,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcCandidateGate"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { RELAXED_TRACE_CLEARANCE } from "lib/testing/drcPresets"
import { MIN_VIA_TO_VIA_CLEARANCE } from "lib/testing/getDrcErrors"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 reuses immutable baseline scopes without aliasing via sites or mutable errors", (): void => {
  const createSignal = (x: number, y: number): PcbTrace => ({
    type: "pcb_trace",
    pcb_trace_id: "signal",
    route: [
      { route_type: "wire", x, y, width: 0.1, layer: "top" },
      { route_type: "wire", x: 0.05, y: 0, width: 0.1, layer: "top" },
    ],
  })
  const currentBoard: AnyCircuitElement[] = [
    {
      type: "source_component",
      ftype: "simple_chip",
      source_component_id: "repeated-via",
      name: "Original via name",
    },
    {
      type: "pcb_port",
      pcb_port_id: "port-start",
      source_port_id: "source-start",
      x: -0.05,
      y: 0,
      layers: ["top"],
    },
    {
      type: "pcb_port",
      pcb_port_id: "port-end",
      source_port_id: "source-end",
      x: 0.05,
      y: 0,
      layers: ["top"],
    },
    createSignal(-0.05, 0),
    {
      type: "pcb_trace",
      pcb_trace_id: "neighbor",
      route: [
        { route_type: "wire", x: -2, y: 0.28, width: 0.1, layer: "top" },
        { route_type: "wire", x: 2, y: 0.28, width: 0.1, layer: "top" },
      ],
    },
    // Both scopes select the same trace IDs and one via with the same opaque
    // ID. Only its immutable array position distinguishes the physical sites.
    ...[-1, 1].map(
      (x): AnyCircuitElement => ({
        type: "pcb_via",
        pcb_via_id: "repeated-via",
        x,
        y: x < 0 ? 0.56 : 0.53,
        outer_diameter: 0.3,
        hole_diameter: 0.15,
        layers: ["top"],
      }),
    ),
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
  const candidateBoards = [-1, 1].map((x): AnyCircuitElement[] =>
    currentBoard.map((element): AnyCircuitElement =>
      element.type === "pcb_trace" && element.pcb_trace_id === "signal"
        ? createSignal(x, 0.28)
        : element,
    ),
  )
  const routesForBoard = (board: AnyCircuitElement[]): HighDensityRoute[] => {
    const signal = board.find(
      (element): element is PcbTrace =>
        element.type === "pcb_trace" && element.pcb_trace_id === "signal",
    )!
    return [
      {
        connectionName: "signal",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: signal.route.map((point): HighDensityRoute["route"][number] => ({
          x: point.x,
          y: point.y,
          z: 0,
        })),
        vias: [],
      },
    ]
  }
  const currentRoutes = routesForBoard(currentBoard)
  const candidateRoutes = candidateBoards.map(routesForBoard)
  const connMap = new ConnectivityMap({
    signalNet: ["signal", "port-start", "port-end"],
    neighborNet: ["neighbor"],
    viaNet: ["repeated-via"],
    padNet: ["pad"],
  })
  const boardsByRoutes = new Map<HighDensityRoute[], AnyCircuitElement[]>([
    [currentRoutes, currentBoard],
    [candidateRoutes[0]!, candidateBoards[0]!],
    [candidateRoutes[1]!, candidateBoards[1]!],
  ])
  const snapshots = new Map<
    HighDensityRoute[],
    Pipeline9HighDensityDrcSnapshot
  >()
  const normalizationCounts = new Map<HighDensityRoute[], number>()
  const getSnapshot = (
    routes: HighDensityRoute[],
  ): Pipeline9HighDensityDrcSnapshot => {
    const cached = snapshots.get(routes)
    if (cached) return cached
    const circuitJson = boardsByRoutes.get(routes)
    if (!circuitJson) throw new Error("The fixture requires a declared board")
    const snapshot: Pipeline9HighDensityDrcSnapshot = {
      circuitJson,
      connMap,
      normalizeErrors: (errors): Pipeline9DrcError[] => {
        normalizationCounts.set(
          routes,
          (normalizationCounts.get(routes) ?? 0) + 1,
        )
        return errors
      },
    }
    snapshots.set(routes, snapshot)
    return snapshot
  }
  const nativeScopeErrors = (
    board: AnyCircuitElement[],
    viaX: number,
  ): Pipeline9DrcError[] => {
    const circuitJson = structuredClone(
      board.filter((element): boolean =>
        element.type === "pcb_via" ? element.x === viaX : true,
      ),
    )
    const traceOptions = { connMap, minClearance: RELAXED_TRACE_CLEARANCE }
    const viaOptions = { connMap, minClearance: MIN_VIA_TO_VIA_CLEARANCE }
    const traceErrors = checkEachPcbTraceNonOverlapping(
      circuitJson,
      traceOptions,
    )
    return [
      ...traceErrors,
      ...checkViaTraceClearance(circuitJson, traceOptions),
      ...checkPadTraceClearance(circuitJson, traceOptions),
      ...checkSameNetViaSpacing(circuitJson, viaOptions),
      ...checkDifferentNetViaSpacing(circuitJson, viaOptions),
    ] as unknown as Pipeline9DrcError[]
  }
  const gate = createPipeline9HighDensityDrcCandidateGate({ getSnapshot })
  const originalBoards = structuredClone([currentBoard, ...candidateBoards])
  const expectedBaselines = [-1, 1].map((x): Pipeline9DrcError[] =>
    nativeScopeErrors(currentBoard, x),
  )
  expect(expectedBaselines[0]).not.toEqual(expectedBaselines[1])
  expect(
    expectedBaselines[0]!.some((error): boolean =>
      String(error.message).includes("port-start"),
    ),
  ).toBeTrue()

  for (const [evaluation, scope] of [0, 1, 0, 0].entries()) {
    const params = {
      currentRoutes,
      candidateRoutes: candidateRoutes[scope]!,
      changedTraceIds: new Set(["signal"]),
    }
    const actual = gate(params)
    expect(actual.currentErrors).toEqual(expectedBaselines[scope])
    expect(actual.candidateErrors).toEqual(
      nativeScopeErrors(candidateBoards[scope]!, scope === 0 ? -1 : 1),
    )
    expect(actual.scopedBaselineEvaluationCount).toBe(evaluation < 2 ? 1 : 0)
    expect(actual.scopedBaselineCacheHitCount).toBe(evaluation < 2 ? 0 : 1)
    expect(actual.scopedBaselineRevisitCount).toBe(evaluation === 2 ? 1 : 0)
    if (evaluation === 0 || evaluation === 2) {
      const viaError = actual.currentErrors.find(
        (error): boolean => error.type === "pcb_via_trace_clearance_error",
      )!
      expect(viaError.message).toContain("Original via name")
      ;(viaError.center as { x: number; y: number }).x = 999
      viaError.message = "Caller changed the error"
      actual.currentErrors.reverse()
      actual.currentErrors.push({ type: "caller_error" })
      actual.candidateErrors.length = 0
    }
  }
  expect(normalizationCounts.get(currentRoutes)).toBe(2)
  expect(normalizationCounts.get(candidateRoutes[0]!)).toBe(3)
  expect(normalizationCounts.get(candidateRoutes[1]!)).toBe(1)
  expect([currentBoard, ...candidateBoards]).toEqual(originalBoards)

  // The same geometry/scope in a new immutable snapshot must read its current
  // metadata. The source-component shadow changes the native via error name.
  const renamedBoard = currentBoard.map((element): AnyCircuitElement =>
    element.type === "source_component"
      ? { ...element, name: "Renamed via" }
      : element,
  )
  const renamedRoutes = routesForBoard(renamedBoard)
  boardsByRoutes.set(renamedRoutes, renamedBoard)
  const renamed = gate({
    currentRoutes: renamedRoutes,
    candidateRoutes: candidateRoutes[0]!,
    changedTraceIds: new Set(["signal"]),
  })
  expect(renamed.scopedBaselineEvaluationCount).toBe(1)
  expect(renamed.scopedBaselineCacheHitCount).toBe(0)
  expect(renamed.scopedBaselineRevisitCount).toBe(0)
  expect(renamed.currentErrors).toEqual(nativeScopeErrors(renamedBoard, -1))
  expect(renamed.currentErrors).not.toEqual(expectedBaselines[0])
  expect(
    renamed.currentErrors.some((error): boolean =>
      String(error.message).includes("Renamed via"),
    ),
  ).toBeTrue()
})
