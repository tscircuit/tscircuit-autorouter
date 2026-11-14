import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { AnyCircuitElement } from "circuit-json"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { RouteStitchClearanceValidator } from "lib/solvers/RouteStitchingSolver/route-stitch-clearance-validator"
import type { SimpleRouteJson } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import {
  type H616TerminalStitchFixture,
  getH616TerminalStitchCircuit,
} from "tests/fixtures/getH616TerminalStitchCircuit"
import { getH616TerminalStitchPcbSvg } from "tests/fixtures/getH616TerminalStitchPcbSvg"

test("preserves the C3 terminal path on the native H616 PCB", async (): Promise<void> => {
  // Full 125-component, 264-net native board from Allwinner_H616_Devboard,
  // commit 94fe1071ff3d7c2e6a227a3e4dfccb6acae305c4. Capture the real stitch
  // input after force improvement and repair, with all other routed nets.
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
  const solver = new MultipleHighDensityRouteStitchSolver3(fixture.input)
  const originalRoutePieces = new Set(fixture.input.hdRoutes)
  const clearance = new RouteStitchClearanceValidator({
    hdRoutes: fixture.input.hdRoutes,
  })
  const gapPieces = solver.unsolvedRoutes.flatMap((route) =>
    route.hdRoutes.filter((piece) => !originalRoutePieces.has(piece)),
  )
  expect(gapPieces.length).toBeGreaterThan(0)
  for (const gap of gapPieces) {
    expect(
      clearance.isSegmentClear({
        connectionName: gap.connectionName,
        start: gap.route[0]!,
        end: gap.route.at(-1)!,
        traceThickness: gap.traceThickness,
      }),
    ).toBeTrue()
  }
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const source = board.circuitJson.find(
    (element) => element.type === "source_component" && element.name === "C3",
  )!
  if (source.type !== "source_component") throw new Error("Missing native C3")
  const component = board.circuitJson.find(
    (element) =>
      element.type === "pcb_component" &&
      element.source_component_id === source.source_component_id,
  )!
  if (component.type !== "pcb_component") throw new Error("Missing C3 PCB")
  const c3PortIds = new Set(
    board.circuitJson
      .filter(
        (element) =>
          element.type === "pcb_port" &&
          element.pcb_component_id === component.pcb_component_id,
      )
      .map((element) => {
        if (element.type !== "pcb_port") throw new Error("Expected PCB port")
        return element.pcb_port_id
      }),
  )
  const connection = fixture.input.connections.find((connection) =>
    connection.pointsToConnect.some((point) =>
      c3PortIds.has(point.pcb_port_id!),
    ),
  )!
  const route = solver.mergedHdRoutes.find(
    (route) => route.connectionName === connection.name,
  )!
  const endpoints = [route.route[0]!, route.route.at(-1)!]
  const connectsBothTerminals = connection.pointsToConnect.every((terminal) =>
    endpoints.some(
      (point) =>
        Math.hypot(point.x - terminal.x, point.y - terminal.y) < 1e-6 &&
        point.z === mapLayerNameToZ(terminal.layer!, board.srj.layerCount),
    ),
  )
  expect(connectsBothTerminals).toBeTrue()
  const circuit = getH616TerminalStitchCircuit({
    board,
    fixture,
    hdRoutes: solver.mergedHdRoutes,
  })
  await expect(getH616TerminalStitchPcbSvg({ circuit })).toMatchSvgSnapshot(
    import.meta.path,
    { scale: 1 },
  )
  await expect(
    getH616TerminalStitchPcbSvg({ circuit, focused: true }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "c3-bottom", scale: 1 })
})
