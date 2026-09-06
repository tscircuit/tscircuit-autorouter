import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace, PcbVia } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import {
  createPipeline9HighDensityDrcCandidateGate,
  type Pipeline9HighDensityDrcSnapshot,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcCandidateGate"
import { normalizePipeline9DrcErrorsForRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalizePipeline9DrcErrorsForRepair"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 candidate force centers use the current physical via snapshot without changing gate errors", (): void => {
  const makeVia = (
    pcb_via_id: string,
    pcb_trace_id: string,
    x: number,
  ): PcbVia => ({
    type: "pcb_via",
    pcb_via_id,
    pcb_trace_id,
    x,
    y: 0.29,
    outer_diameter: 0.3,
    hole_diameter: 0.15,
    layers: ["top", "bottom"],
  })
  const firstVias = [
    makeVia("opaque_via_a", "original-owner", -3),
    makeVia("opaque_via_b", "original-owner", -2.8),
  ]
  const makeBoard = (y: number, vias: PcbVia[]): AnyCircuitElement[] => [
    {
      type: "pcb_trace",
      pcb_trace_id: "signal",
      route: [
        { route_type: "wire", x: -4, y, width: 0.1, layer: "top" },
        { route_type: "wire", x: 4, y, width: 0.1, layer: "top" },
      ],
    },
    ...vias,
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "foreign-pad",
      shape: "circle",
      x: 0,
      y: -0.21,
      radius: 0.1,
      layer: "top",
    },
  ]
  const currentBoard = makeBoard(-0.2, firstVias)
  const candidateBoards = [
    makeBoard(0, firstVias),
    // The same physical copper can acquire different serialized IDs/owners.
    makeBoard(0, [
      makeVia("renamed_via_a", "renamed-owner", -3),
      makeVia("renamed_via_b", "renamed-owner", -2.8),
    ]),
    makeBoard(0, [
      makeVia("repeated_via", "first-owner", -3),
      makeVia("repeated_via", "last-owner", -2.8),
    ]),
    makeBoard(0, [
      makeVia("opaque_via_a", "original-owner", 3),
      makeVia("opaque_via_b", "original-owner", 3.2),
    ]),
  ]
  const newTraceIds = new Set([
    "signal",
    "original-owner",
    "renamed-owner",
    "first-owner",
    "last-owner",
  ])
  const snapshots = new Map<
    HighDensityRoute[],
    Pipeline9HighDensityDrcSnapshot
  >()
  const normalizationCounts = new Map<HighDensityRoute[], number>()
  const normalize = (
    board: AnyCircuitElement[],
    errors: Pipeline9DrcError[],
  ): Pipeline9DrcError[] =>
    normalizePipeline9DrcErrorsForRepair({
      errors,
      circuitJson: board,
      newTraceIds,
    })
  const addSnapshot = (board: AnyCircuitElement[]): HighDensityRoute[] => {
    const trace = board.find(
      (element): element is PcbTrace => element.type === "pcb_trace",
    )!
    const routes: HighDensityRoute[] = [
      {
        connectionName: "signal",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: trace.route.map((point): HighDensityRoute["route"][number] => {
          if (point.route_type !== "wire" || point.layer !== "top") {
            throw new Error("The fixture requires planar top wires")
          }
          return { x: point.x, y: point.y, z: 0 }
        }),
        vias: [],
      },
    ]
    const connMap = getFullConnectivityMapFromCircuitJson(board)
    connMap.addConnections(
      board.flatMap(
        (element): Array<[string, string]> =>
          element.type === "pcb_via" && typeof element.pcb_trace_id === "string"
            ? [[element.pcb_via_id, element.pcb_trace_id]]
            : [],
      ),
    )
    snapshots.set(routes, {
      circuitJson: board,
      connMap,
      normalizeErrors: (errors): Pipeline9DrcError[] => {
        normalizationCounts.set(
          routes,
          (normalizationCounts.get(routes) ?? 0) + 1,
        )
        return normalize(board, errors)
      },
    })
    return routes
  }
  const currentRoutes = addSnapshot(currentBoard)
  const candidateRoutes = candidateBoards.map(addSnapshot)
  const getSnapshot = (
    routes: HighDensityRoute[],
  ): Pipeline9HighDensityDrcSnapshot => {
    const snapshot = snapshots.get(routes)
    if (!snapshot) throw new Error("The fixture requires a declared snapshot")
    return snapshot
  }
  const gate = createPipeline9HighDensityDrcCandidateGate({ getSnapshot })
  const originalBoards = structuredClone([currentBoard, ...candidateBoards])
  const originalRoutes = structuredClone([currentRoutes, ...candidateRoutes])
  const options = {
    ...RELAXED_DRC_OPTIONS,
    includeBoardEdge: false,
    includeTraceContinuity: false,
  }
  const fullCurrent = getDrcErrors(structuredClone(currentBoard), options)
  const expectedCurrent = normalize(
    currentBoard,
    fullCurrent.errors as unknown as Pipeline9DrcError[],
  )
  for (const [index, routes] of candidateRoutes.entries()) {
    const board = candidateBoards[index]!
    const full = getDrcErrors(structuredClone(board), options)
    const expectedErrors = normalize(
      board,
      full.errors as unknown as Pipeline9DrcError[],
    )
    const expectedForceErrors = normalize(
      board,
      full.errorsWithCenters as unknown as Pipeline9DrcError[],
    )
    const params = {
      currentRoutes,
      candidateRoutes: routes,
      changedTraceIds: new Set(["signal"]),
    }
    const actual = gate(params)
    expect(actual.currentErrors).toEqual(expectedCurrent)
    expect(actual.candidateErrors).toEqual(expectedErrors)
    expect(actual.candidateForceErrors).toEqual(expectedForceErrors)
    expect(normalizationCounts.get(routes)).toBe(1)
    const forceErrors = actual.candidateForceErrors
    if (!forceErrors) throw new Error("Candidate force feedback is required")
    const viaError = forceErrors.find(
      (error) => error.type === "pcb_via_trace_clearance_error",
    )!
    const rawViaError = actual.candidateErrors.find(
      (error) => error.type === "pcb_via_trace_clearance_error",
    )!
    expect(rawViaError.center).toEqual({ x: 0, y: 0 })
    expect(viaError.center).not.toEqual(rawViaError.center)
    const viasById = new Map(
      board.flatMap(
        (element): Array<[string, PcbVia]> =>
          element.type === "pcb_via" ? [[element.pcb_via_id, element]] : [],
      ),
    )
    if (typeof viaError.pcb_via_id !== "string") {
      throw new Error("The native via error must identify its physical via")
    }
    const via = viasById.get(viaError.pcb_via_id)!
    expect(viaError.center).toEqual({ x: via.x, y: via.y })
    expect(viaError.pcb_trace_ids).toContain(via.pcb_trace_id)
    if (index === 1) expect(viaError.pcb_via_id).toBe("renamed_via_a")
    if (index === 2) {
      expect(viaError.center).toEqual({ x: -2.8, y: 0.29 })
      expect(viaError.pcb_trace_ids).toContain("last-owner")
    }
    const spacing = forceErrors.find(
      (error) => error.type === "pcb_via_clearance_error",
    )!
    expect(spacing.center).toEqual(spacing.pcb_center)
    const rawSpacing = actual.candidateErrors.find(
      (error) => error.type === "pcb_via_clearance_error",
    )!
    expect(rawSpacing.center).toBeUndefined()
    const untouchedErrors = structuredClone({
      current: actual.currentErrors,
      candidate: actual.candidateErrors,
    })
    const center = viaError.center
    if (!center || typeof center !== "object" || !("x" in center)) {
      throw new Error("Force feedback must have a mutable detached center")
    }
    center.x = 999
    if (Array.isArray(viaError.pcb_trace_ids)) {
      viaError.pcb_trace_ids.push("caller-mutation")
    }
    forceErrors.reverse()
    expect({
      current: actual.currentErrors,
      candidate: actual.candidateErrors,
    }).toEqual(untouchedErrors)
    const repeated = gate(params)
    expect(repeated.candidateForceErrors).toEqual(expectedForceErrors)
    expect(repeated.currentErrors).toEqual(expectedCurrent)
    expect(repeated.candidateErrors).toEqual(expectedErrors)
    expect(normalizationCounts.get(routes)).toBe(2)
  }
  expect(normalizationCounts.get(currentRoutes)).toBe(1)
  expect([currentBoard, ...candidateBoards]).toEqual(originalBoards)
  expect([currentRoutes, ...candidateRoutes]).toEqual(originalRoutes)
})
