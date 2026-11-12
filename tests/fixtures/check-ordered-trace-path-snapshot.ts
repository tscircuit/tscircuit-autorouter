import { expect } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { AutoroutingPipelineSolver } from "lib"
import type { SimpleRouteJson } from "lib/types"
import { getPcbSnapshot } from "./get-pcb-snapshot"
import capturedSrj from "./ordered-trace-path.srj.json" with { type: "json" }
import artwork from "./ordered-trace-path.artwork.json" with { type: "json" }

export async function checkOrderedTracePathSnapshot(
  testPath: string,
): Promise<void> {
  const srj = structuredClone(capturedSrj) as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver(srj, { cacheProvider: null })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const connections = solver.netToPointPairsSolver!.newConnections
  // Captured TSX declares these exact terminal IDs in C -> A -> B order.
  const labels = new Map(
    srj.connections[0]!.path!.map((id, index) => [id, ["C", "A", "B"][index]]),
  )
  const links = connections.map(({ pointsToConnect }) =>
    pointsToConnect.map((point) => labels.get(point.pointId!)).join("-"),
  )
  expect(links).toEqual(["A-C", "C-B"])
  console.log("Trace path actual links:", links)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const copperLength = traces.reduce(
    (total, trace) =>
      total +
      trace.route.slice(1).reduce((length, point, index) => {
        const previous = trace.route[index]!
        return (
          length +
          ("x" in point && "x" in previous
            ? Math.hypot(point.x - previous.x, point.y - previous.y)
            : 0)
        )
      }, 0),
    0,
  )
  console.log("Trace path copper (mm):", copperLength)
  expect(connections).toHaveLength(2)
  await expect(
    getPcbSnapshot(
      solver.srjWithPointPairs!,
      traces,
      [
        "tscircuit-autorouter: routes copper; checks trace path order",
        `Written path: C -> A -> B (${srj.connections[0]!.path!.length} pads)`,
        `main: actual links ${links.join(", ")}; A-B is missing`,
        `Pipeline 9 solved: ${traces.length} traces, ${copperLength.toFixed(3)} mm copper`,
      ],
      artwork as AnyCircuitElement[],
    ),
  ).toMatchSvgSnapshot(testPath)
}
