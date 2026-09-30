import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { expect, test } from "bun:test"
import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import { stackSvgsHorizontally } from "stack-svgs"

test("Pipeline 9 places a V3V3 via too close to the metal-touch controller GND pad", async (): Promise<void> => {
  const fixtureDirectory = "../../fixtures/bug-reports/metal-touch-via-pad-clearance/"
  const inputBytes = gunzipSync(Uint8Array.from(readFileSync(new URL(`${fixtureDirectory}input.srj.json.gz`, import.meta.url))))
  const circuitBytes = gunzipSync(Uint8Array.from(readFileSync(new URL(`${fixtureDirectory}unrouted.circuit.json.gz`, import.meta.url))))
  expect(createHash("sha256").update(inputBytes.toString("utf8")).digest("hex")).toBe("851680efcc93d52b162577f18a3f14f55646c05102288e8090ea782cd4b0a108")
  expect(createHash("sha256").update(circuitBytes.toString("utf8")).digest("hex")).toBe("be0ae9459d19a8066689acaf79a264b48de1bb44e2260e9413d49aa4cff358c2")
  const input: SimpleRouteJson = JSON.parse(inputBytes.toString())
  const circuitJson: CircuitJson = JSON.parse(circuitBytes.toString())
  expect(input.minViaEdgeToPadEdgeClearance).toBe(0.15)
  expect(input.connections).toHaveLength(23)
  expect(input.obstacles).toHaveLength(254)
  expect(circuitJson.filter((element) => element.type === "pcb_component")).toHaveLength(14)
  // Preserve the authored winding copper; none of the old routed output is reused.
  expect(circuitJson.filter((element) => element.type === "pcb_trace")).toHaveLength(4)
  expect(circuitJson.filter((element) => element.type === "pcb_via")).toHaveLength(0)

  const groundPad = input.obstacles.find((obstacle) => obstacle.circuitJsonMetadata?.pcb_smtpad_id === "pcb_smtpad_9")!
  expect(groundPad.connectedTo).toContain("source_net_0")
  expect(groundPad.connectedTo).not.toContain("source_net_1")
  expect(groundPad.layers).toEqual(["bottom"])
  expect(circuitJson.find((element) => element.type === "pcb_smtpad" && element.pcb_smtpad_id === "pcb_smtpad_9")).toMatchObject({
    x: groundPad.center.x,
    y: groundPad.center.y,
    width: groundPad.width,
    height: groundPad.height,
    layer: "bottom",
  })
  expect(circuitJson.find((element) => element.type === "source_net" && element.source_net_id === "source_net_1")).toMatchObject({ name: "V3V3" })
  expect(circuitJson.find((element) => element.type === "source_net" && element.source_net_id === "source_net_0")).toMatchObject({ name: "GND" })

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(input), { cacheProvider: null })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(33)
  const powerVias = traces
    .filter((trace) => trace.connection_name === "source_net_1" || trace.pcb_trace_id.startsWith("source_net_1_"))
    .flatMap((trace) => trace.route.filter((point) => point.route_type === "via"))
    .filter((via, index, vias) => vias.findIndex((other) => other.x === via.x && other.y === via.y) === index)
  // Board-world millimeter points, +X right and +Y up. Distance from a via
  // disk to this axis-aligned rectangle is center-to-rectangle distance minus radius.
  const violations = powerVias.map((via) => {
    expect(via.via_diameter).toBe(0.6)
    const dx = Math.max(Math.abs(via.x - groundPad.center.x) - groundPad.width / 2, 0)
    const dy = Math.max(Math.abs(via.y - groundPad.center.y) - groundPad.height / 2, 0)
    return { via, gap: Math.hypot(dx, dy) - via.via_diameter! / 2 }
  }).filter(({ gap }) => gap < input.minViaEdgeToPadEdgeClearance!)
  // This repro deliberately asserts the current defect. A fix must change this
  // to require zero violations; rendering failures must never count as success.
  expect(violations).toHaveLength(1)
  const { via, gap } = violations[0]!
  expect([via.from_layer, via.to_layer]).toContain("bottom")
  expect(via.x).toBeCloseTo(-0.6348087672, 8)
  expect(via.y).toBeCloseTo(-2.54004, 8)
  expect(gap).toBeCloseTo(0.0000013, 9)
  expect(gap).toBeLessThan(input.minViaEdgeToPadEdgeClearance!)

  const routedCircuit = convertToCircuitJson(solver.srjWithPointPairs!, traces, {
    originalSrj: input,
    includeOriginalConnections: true,
    minTraceWidth: input.minTraceWidth,
    minViaDiameter: input.minViaDiameter,
  }) as CircuitJson
  const copper = routedCircuit.filter((element) => element.type === "pcb_trace" || element.type === "pcb_via")
  const focusSvg = getSvgFromGraphicsObject({
    texts: [
      { x: -0.65, y: -1.1, text: "U1 GND / V3V3 via", fontSize: 0.1 },
      { x: -0.65, y: -1.3, text: "Bottom-layer copper clearance", fontSize: 0.065 },
      { x: groundPad.center.x, y: -1.48, text: "GND pad", fontSize: 0.065, color: "#2563eb" },
      { x: via.x, y: -3.12, text: "V3V3 via: 0.6 mm copper / 0.3 mm drill", fontSize: 0.06, color: "#92400e" },
      { x: via.x, y: -3.3, text: `Actual gap: ${gap.toFixed(7)} mm`, fontSize: 0.075, color: "#b91c1c" },
      { x: via.x, y: -3.47, text: `Required gap: ${input.minViaEdgeToPadEdgeClearance} mm`, fontSize: 0.075 },
      { x: via.x, y: -3.65, text: "Pink clearance area overlaps the GND pad", fontSize: 0.06, color: "#b91c1c" },
    ],
    rects: [{ center: groundPad.center, width: groundPad.width, height: groundPad.height, fill: "#2563eb", label: "U1 GND pad (bottom)" }],
    circles: [
      { center: via, radius: via.via_diameter! / 2 + input.minViaEdgeToPadEdgeClearance!, fill: "#ef444415", stroke: "#ef4444", label: "Required 0.15 mm clearance reaches inside GND pad" },
      { center: via, radius: via.via_diameter! / 2, fill: "#f59e0b", stroke: "#b45309", label: `V3V3 via: actual gap ${gap.toFixed(7)} mm` },
      { center: via, radius: via.via_hole_diameter! / 2, fill: "white", stroke: "#b45309" },
    ],
  }, { backgroundColor: "white", svgWidth: 700, svgHeight: 700 })
  await expect(stackSvgsHorizontally([
    convertCircuitJsonToPcbSvg([...circuitJson, ...copper]),
    focusSvg,
  ], { gap: 12, normalizeSize: false }).replace(/[ \t]+$/gm, "")).toMatchSvgSnapshot(import.meta.path, { svgName: "board-and-clearance", tolerance: 0.02 })
})
