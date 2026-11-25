import { checkTraceContinuity } from "lib/utils/autorouting-drc/checkTraceContinuity"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import capturedInput from "./assets/bluetooth-gamepad.srj.json"

type XY = { x: number; y: number }

// Measure the PCB centerlines across trace boundaries, including a shared
// trunk and its crystal arm.
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
        const a = key(previous)
        const b = key(point)
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

test("the Bluetooth gamepad routes with zero copper errors, connected terminals and via-free crystal paths under 10 mm", async (): Promise<void> => {
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const snapshotInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    includeBoardClearance: true,
    drcOptions: {
      traceClearance: input.minTraceToPadEdgeClearance,
      // Check continuity through poured copper below, using the exported board.
      includeTraceContinuity: false,
    },
  }
  const { errors, locationAwareErrors, circuitJson } =
    evaluateRelaxedDrc(snapshotInput)
  expect(locationAwareErrors).toHaveLength(errors.length)
  expect(checkTraceContinuity(circuitJson)).toHaveLength(0)
  const withoutPours = circuitJson.filter((e) => e.type !== "pcb_copper_pour")
  expect(checkTraceContinuity(withoutPours).length).toBeGreaterThan(0)
  await expect(
    getBugReportSnapshotSvg(snapshotInput, { showErrorLocations: true }),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(errors).toHaveLength(0)

  for (const [clock, mcu, crystal, capacitor] of [
    ["source_net_19", "pcb_port_33", "pcb_port_57", "pcb_port_61"],
    ["source_net_20", "pcb_port_34", "pcb_port_60", "pcb_port_63"],
  ] as const) {
    const branches = input.connections.filter(
      (c) => c.netConnectionName === clock,
    )
    expect(branches).toHaveLength(3)
    const terminals = [mcu, crystal, capacitor].map((id) => {
      const branch = branches.find((c) => c.pointsToConnect[0]?.pointId === id)!
      expect(branch.pointsToConnect).toHaveLength(1)
      expect(branch.maxLength).toBe(10)
      expect(branch.maxViaCount).toBe(0)
      return branch.pointsToConnect[0]!
    })
    const routes = solver
      .getOutputSimplifiedPcbTraces()
      .filter((trace) => trace.connection_name === clock)
    checkClock(routes, terminals[0]!, terminals[1]!, terminals[2]!)
  }
})
