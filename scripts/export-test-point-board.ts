import { mkdirSync, writeFileSync } from "node:fs"
import { getSvgFromGraphicsObject, getPngBufferFromGraphicsObject } from "graphics-debug"
import { TestPointSolver } from "../lib/solvers/TestPointSolver/TestPointSolver"
import type { SimpleRouteJson } from "../lib/types"
import input from "../tests/test-points/fixtures/astra-pd-power-supply.srj.json"

const solver = new TestPointSolver(input as SimpleRouteJson, {
  requests: [
    { name: "TP_SDA", pcbTraceId: "source_net_33_mst0_0", layer: "bottom", diameter: 1 },
    { name: "TP_SCL", pcbTraceId: "source_net_34_mst0_0", layer: "bottom", diameter: 1 },
    { name: "TP_OUTPUT_EN", pcbTraceId: "source_net_50_mst1_0", layer: "bottom", diameter: 1 },
  ], clearance: 0.2, minProbeSpacing: 2.54, maxDetour: 1,
})
solver.solve()
const directory = process.argv[2] ?? "test-point-artifacts"
mkdirSync(directory, { recursive: true })
const graphics = solver.visualize()
// Board coordinates are retained: the bottom view is not mirrored into fixture coordinates.
writeFileSync(`${directory}/pd-power-supply-test-points.svg`, getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }))
writeFileSync(`${directory}/pd-power-supply-test-points.png`, await getPngBufferFromGraphicsObject(graphics, { backgroundColor: "white", pngWidth: 1536, pngHeight: 1024 }))
writeFileSync(`${directory}/pd-power-supply-test-points.srj.json`, JSON.stringify(solver.getOutput(), null, 2))
writeFileSync(`${directory}/probe-targets.json`, JSON.stringify({ board: "astra/pd-power-supply", release: "57387f49-bd91-4277-8a82-706b1575c5ed", units: "mm", coordinateFrame: "board (+X right, +Y up), not mirrored", testPoints: solver.getOutput().testPoints }, null, 2))
