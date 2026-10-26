import { createHash } from "node:crypto"
import { writeFileSync, mkdirSync } from "node:fs"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

const input: SimpleRouteJson = {
  layerCount: 2, minTraceWidth: 0.1,
  bounds: { minX: -4, maxX: 4, minY: -3, maxY: 3 },
  obstacles: [-2, 2].map(x => ({ type: "rect", center: { x, y: 0 }, width: 0.5, height: 0.5, layers: ["top"], connectedTo: ["signal"], circuitJsonMetadata: { pcb_port_id: x < 0 ? "pcb_port_left" : "pcb_port_right" } })),
  connections: [{ name: "signal", pointsToConnect: [{ x: -2, y: 0, layer: "top", pcb_port_id: "pcb_port_left" }, { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_right" }] }],
}
const results = []
for (const requested of [undefined, 8, 100]) {
  const started = performance.now()
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { pathingEffort: requested, cacheProvider: null } as any)
  solver.solve()
  if (!solver.solved) throw new Error(solver.error ?? "Native control did not solve")
  const traces = solver.getOutputSimplifiedPcbTraces()
  const drc = evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: traces })
  if (drc.errors.length) throw new Error("Native pathing control failed DRC")
  results.push({ requestedPathingEffort: requested ?? null, observedPathingEffort: solver.portPointPathingSolver!.getConstructorParams()[0].effort,
    nativePathingIterationCap: solver.portPointPathingSolver!.MAX_ITERATIONS,
    solved: solver.solved, error: solver.error, traceCount: traces.length, drcErrorCount: drc.errors.length, drcErrors: drc.errors,
    inputSha256: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
    outputSha256: createHash("sha256").update(JSON.stringify(traces)).digest("hex"),
    elapsedMs: performance.now() - started, peakRssBytes: process.resourceUsage().maxRSS * 1024 })
  if (process.argv.includes("--visual") && requested === 8) {
    const { getSvgFromGraphicsObject } = await import("graphics-debug")
    const { Resvg } = await import("@resvg/resvg-js")
    mkdirSync("docs/explicit-pathing-effort", { recursive: true })
    const svg = getSvgFromGraphicsObject(convertSrjToGraphicsObject(solver.getOutputSimpleRouteJson()))
    writeFileSync("docs/explicit-pathing-effort/completed-control.svg", svg)
    writeFileSync("docs/explicit-pathing-effort/completed-control.png", new Resvg(svg).render().asPng())
  }
}
console.log(JSON.stringify(results, null, 2))
