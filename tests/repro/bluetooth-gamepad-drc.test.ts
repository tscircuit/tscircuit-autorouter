import { beforeAll, expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import capturedInput from "./assets/bluetooth-gamepad.srj.json"

type XY = { x: number; y: number }

// The clock limits live on the source board. Measure the PCB centerlines
// across trace boundaries, including a shared trunk and its crystal arm.
function checkClock(
  traces: SimplifiedPcbTrace[],
  mcu: XY,
  crystal: XY,
  capacitor: XY,
): void {
  const key = (p: XY): string => `${p.x.toFixed(6)},${p.y.toFixed(6)}`
  const edges = new Map<string, { to: string; length: number }[]>()
  for (const trace of traces) {
    let previous: XY | undefined
    for (const point of trace.route) {
      if (point.route_type !== "wire" || point.layer !== "top") {
        throw new Error(
          "Crystal wiring must stay on the top layer without vias",
        )
      }
      if (previous) {
        const a = key(previous),
          b = key(point)
        const length = Math.hypot(previous.x - point.x, previous.y - point.y)
        for (const [from, to] of [
          [a, b],
          [b, a],
        ] as const) {
          if (!edges.has(from)) edges.set(from, [])
          edges.get(from)!.push({ to, length })
        }
      }
      previous = point
    }
  }
  const distances = new Map([[key(mcu), 0]])
  const queue = [key(mcu)]
  while (queue.length) {
    const from = queue.pop()!
    for (const edge of edges.get(from) ?? []) {
      const length = distances.get(from)! + edge.length
      if (length >= (distances.get(edge.to) ?? Infinity)) continue
      distances.set(edge.to, length)
      queue.push(edge.to)
    }
  }
  expect(distances.has(key(capacitor))).toBe(true)
  expect(distances.get(key(crystal)) ?? Infinity).toBeLessThanOrEqual(10)
}

const input = structuredClone(capturedInput) as SimpleRouteJson
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
  cacheProvider: null,
})

beforeAll(() => {
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
})

test("copper DRC on the four-layer Bluetooth gamepad", async (): Promise<void> => {
  const snapshotInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    includeBoardClearance: true,
    drcOptions: {
      traceClearance: input.minTraceToPadEdgeClearance,
      // Connectivity through the poured planes is resolved by the board renderer.
      includeTraceContinuity: false,
    },
  }
  const { errors, locationAwareErrors } = evaluateRelaxedDrc(snapshotInput)
  expect(locationAwareErrors).toHaveLength(errors.length)
  const contacts = errors.filter((error) =>
    error.message.includes("accidental contact"),
  )
  expect(contacts).toHaveLength(0)
  await expect(
    getBugReportSnapshotSvg(snapshotInput, { showErrorLocations: true }),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(errors).toHaveLength(0)
})

test("the MCU-to-crystal routes meet the board's 10 mm limit", () => {
  for (const clock of ["source_net_19", "source_net_20"]) {
    const terminals = input.connections.find(
      (c) => c.name === clock,
    )!.pointsToConnect
    const routes = solver
      .getOutputSimplifiedPcbTraces()
      .filter((trace) => trace.connection_name === clock)
    checkClock(routes, terminals[0]!, terminals[1]!, terminals[2]!)
  }
})
