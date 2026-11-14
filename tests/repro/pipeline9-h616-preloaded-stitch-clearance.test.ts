import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { RouteStitchClearanceValidator } from "lib/solvers/RouteStitchingSolver/route-stitch-clearance-validator"
import type { SimpleRouteJson } from "lib/types"
import {
  type H616TerminalStitchFixture,
  getH616TerminalStitchCircuit,
} from "tests/fixtures/getH616TerminalStitchCircuit"
import { getH616TerminalStitchPcbSvg } from "tests/fixtures/getH616TerminalStitchPcbSvg"

test("keeps H616 SVREF stitches clear of the existing SA1 via", async (): Promise<void> => {
  const board = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-preloaded-board-clearance.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as { circuitJson: AnyCircuitElement[]; srj: SimpleRouteJson }
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-terminal-stitch.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as H616TerminalStitchFixture
  const otherHdRoutes = fixture.preloadedRoutes.map((route) => ({
    ...route,
    rootConnectionName:
      board.srj.traces![route.preloadedTraceIndex]!.connection_name,
  }))
  const input = {
    ...fixture.input,
    otherHdRoutes,
    minClearance: board.srj.minTraceToPadEdgeClearance,
  }
  const solver = new MultipleHighDensityRouteStitchSolver3(input)
  const originalRoutePieces = new Set(fixture.input.hdRoutes)
  const clearance = new RouteStitchClearanceValidator({
    hdRoutes: [...fixture.input.hdRoutes, ...otherHdRoutes],
    minClearance: board.srj.minTraceToPadEdgeClearance,
  })
  const gapPieces = solver.unsolvedRoutes.flatMap((route) =>
    route.hdRoutes.filter((piece) => !originalRoutePieces.has(piece)),
  )
  expect(gapPieces.length).toBeGreaterThan(0)
  const blockedGaps = gapPieces.filter(
    (gap) =>
      !clearance.isSegmentClear({
        connectionName: gap.connectionName,
        start: gap.route[0]!,
        end: gap.route.at(-1)!,
        traceThickness: gap.traceThickness,
      }),
  )
  expect(blockedGaps).toHaveLength(0)
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const circuit = getH616TerminalStitchCircuit({
    board,
    fixture,
    hdRoutes: solver.mergedHdRoutes,
  })
  await expect(getH616TerminalStitchPcbSvg({ circuit })).toMatchSvgSnapshot(
    import.meta.path,
    { scale: 1 },
  )
  const sa1 = board.circuitJson.find(
    (element) =>
      element.type === "source_trace" && element.display_name === "/DRAM/SA1",
  )!
  if (sa1.type !== "source_trace") throw new Error("Missing native SA1 net")
  const u2 = board.circuitJson.find(
    (element) => element.type === "source_component" && element.name === "U2",
  )!
  if (u2.type !== "source_component") throw new Error("Missing native U2")
  const component = board.circuitJson.find(
    (element) =>
      element.type === "pcb_component" &&
      element.source_component_id === u2.source_component_id,
  )!
  if (component.type !== "pcb_component") throw new Error("Missing U2 PCB")
  const sa1Vias = fixture.preloadedRoutes
    .filter((route) =>
      sa1.connected_source_net_ids?.includes(
        board.srj.traces![route.preloadedTraceIndex]!.connection_name,
      ),
    )
    .flatMap((route) => route.vias)
    .sort(
      (left, right) =>
        Math.hypot(left.x - component.center.x, left.y - component.center.y) -
        Math.hypot(right.x - component.center.x, right.y - component.center.y),
    )
  const via = sa1Vias[0]
  if (!via) throw new Error("Missing native SA1 via beside U2")
  const svref = board.circuitJson.find(
    (element) =>
      element.type === "source_trace" && element.display_name === "/DRAM/SVREF",
  )!
  if (svref.type !== "source_trace") throw new Error("Missing native SVREF net")
  const viaRoute = otherHdRoutes.find((route) => route.vias.includes(via))
  if (!viaRoute) throw new Error("Missing SA1 via copper dimensions")
  const svrefConnections = new Set(
    fixture.input.connections
      .filter((connection) =>
        connection.__rootConnectionNames?.some((netId) =>
          svref.connected_source_net_ids?.includes(netId),
        ),
      )
      .map((connection) => connection.name),
  )
  const svrefRoutes = solver.mergedHdRoutes.filter((route) =>
    svrefConnections.has(route.connectionName),
  )
  expect(svrefRoutes.length).toBeGreaterThan(0)
  let minimumCopperGap = Infinity
  for (const route of svrefRoutes) {
    for (let index = 1; index < route.route.length; index++) {
      const start = route.route[index - 1]!
      const end = route.route[index]!
      if (start.z !== end.z) continue
      const copperGap =
        pointToSegmentDistance(via, start, end) -
        viaRoute.viaDiameter / 2 -
        (start.traceThickness ?? route.traceThickness) / 2
      minimumCopperGap = Math.min(minimumCopperGap, copperGap)
    }
  }
  expect(minimumCopperGap).toBeGreaterThanOrEqual(0)
  const focusedNetIds = new Set([sa1.source_trace_id, svref.source_trace_id])
  const focusedTraceIds = new Set(
    circuit.flatMap((element) =>
      element.type === "pcb_trace" &&
      element.source_trace_id !== undefined &&
      focusedNetIds.has(element.source_trace_id)
        ? [element.pcb_trace_id]
        : [],
    ),
  )
  const focusedCircuit = circuit
    .filter((element) => {
      if (element.type === "pcb_trace") {
        return focusedTraceIds.has(element.pcb_trace_id)
      }
      if (element.type === "pcb_via") {
        return focusedTraceIds.has(element.pcb_trace_id!)
      }
      return true
    })
    .map((element): AnyCircuitElement => {
      if (element.type !== "pcb_board") return element
      return {
        ...element,
        center: { x: via.x, y: via.y },
        width: 3,
        height: 3,
        outline: undefined,
      }
    })
  const focusedSvg = convertCircuitJsonToPcbSvg(focusedCircuit, {
    width: 1000,
    height: 1000,
    backgroundColor: "white",
    colorOverrides: {
      copper: {
        top: "#dc2626",
        bottom: "#2563eb",
        inner1: "#16a34a",
        inner2: "#ca8a04",
      },
    },
    drawPaddingOutsideBoard: false,
    renderSolderMask: false,
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
  })
  const labeledFocus = focusedSvg.replace(
    "</svg>",
    '<rect x="0" y="0" width="1000" height="50" fill="white"/><text x="500" y="32" text-anchor="middle" font-family="sans-serif" font-size="23" fill="#334155">SVREF on inner1 (green) / existing SA1 via</text></svg>',
  )
  await expect(labeledFocus).toMatchSvgSnapshot(import.meta.path, {
    svgName: "sa1-via",
    scale: 1,
  })
})
