import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import {
  getH616WidthCircuit,
  type H616WidthFixture,
} from "tests/fixtures/getH616WidthCircuit"

test("H616 DDR restores clear layer spans without changing its native placement", async (): Promise<void> => {
  const fixture: H616WidthFixture = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-ddr-layer-widths.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  )
  const solver = new TraceWidthSolver({
    ...fixture.widthInput,
    connMap: getConnectivityMapFromSimpleRouteJson(fixture.inputSrj),
  })
  solver.solve()
  const routes = solver.refineWidths({ hdRoutes: solver.getHdRoutesWithWidths() })
  expect(solver.solved).toBe(true)
  const target = routes.find(
    (route) => route.connectionName === fixture.focus.connectionName,
  )
  expect(target?.route[fixture.focus.pointIndex]?.traceThickness).toBe(
    fixture.focus.requestedWidth,
  )
  const circuit = getH616WidthCircuit({ fixture, hdRoutes: routes })
  expect(
    getDrcErrors(circuit, {
      traceClearance: 0.1,
      viaToPadClearance: 0.1,
      includeTraceContinuity: false,
    }).errors,
  ).toEqual([])
  expect(circuit.filter((element) => element.type === "pcb_component")).toEqual(
    fixture.nativeCircuit.filter((element) => element.type === "pcb_component"),
  )
  expect(
    routes.map((route) => route.route.map(({ x, y, z }) => ({ x, y, z }))),
  ).toEqual(
    fixture.widthInput.hdRoutes.map((route) =>
      route.route.map(({ x, y, z }) => ({ x, y, z })),
    ),
  )
  expect(routes.map((route) => route.vias)).toEqual(
    fixture.widthInput.hdRoutes.map((route) => route.vias),
  )
  const svg = convertCircuitJsonToPcbSvg(circuit, {
    width: 1000,
    height: 2200,
    backgroundColor: "white",
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
    renderSolderMask: false,
    colorOverrides: {
      copper: { top: "#dc2626", bottom: "#2563eb" },
      boardOutline: "#475569",
      silkscreen: { top: "#334155", bottom: "#64748b" },
    },
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 1 })
  const { center } = fixture.focus
  // Change only the camera bounds; retain the real pads and copper.
  const focusedCircuit = circuit.map((element) =>
    element.type === "pcb_board"
      ? { ...element, center, width: 10, height: 7, outline: undefined }
      : element,
  )
  const focused = convertCircuitJsonToPcbSvg(focusedCircuit, {
    width: 1100,
    height: 800,
    backgroundColor: "white",
    layer: "top",
    drawPaddingOutsideBoard: false,
    renderSolderMask: false,
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
    colorOverrides: { copper: { top: "#dc2626" } },
  })
  await expect(focused).toMatchSvgSnapshot(import.meta.path, {
    svgName: "clock",
    scale: 1,
  })
})
