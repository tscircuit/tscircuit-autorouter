import { FindClearancePathSolver, type ClearancePathInput } from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { Pipeline9DenseClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair04/Pipeline9DenseClearancePathSolver"

test("bounded clearance bucket columns preserve native query decisions and work across physical geometry", (): void => {
  let state = 0x6194821
  let found = 0
  let limited = 0
  for (let fixture = 0; fixture < 144; fixture++) {
    const offset = fixture % 12 === 0 ? 10001 : -2.125
    const width = fixture % 12 === 1 ? 514 : 10
    const height = fixture % 12 === 1 ? 514 : 10
    const bounds = { minX: offset - width / 2, maxX: offset + width / 2, minY: -.375 - height / 2, maxY: -.375 + height / 2 }
    const layerCount = fixture % 3 === 0 ? 4 : 2
    const start = { x: offset - 4.5, y: -.375, z: 0 }
    const end = { x: offset + 4.5, y: -.375, z: fixture % 5 === 0 ? layerCount - 1 : 0 }
    const obstacles: ClearancePathInput["srj"]["obstacles"] = []
    for (let obstacle = 0; obstacle < 6; obstacle++) {
      state = Math.imul(state, 1664525) + 1013904223 | 0
      const x = offset + ((state >>> 0) / 2 ** 32 - .5) * 7
      state = Math.imul(state, 1664525) + 1013904223 | 0
      const y = ((state >>> 0) / 2 ** 32 - .5) * 6 - .375
      const isHole = obstacle % 4 === 0
      obstacles.push({
        type: "rect",
        shape: isHole ? "circle" : undefined,
        center: { x, y },
        width: isHole ? .4 : .35 + (obstacle % 3) * .125,
        height: isHole ? .4 : 1.25,
        isNonPlatedHole: isHole,
        ccwRotationDegrees: isHole ? undefined : (fixture * 13 + obstacle * 31) % 360,
        layers: isHole ? ["top", "bottom"] : ["top"],
        connectedTo: [`obstacle${obstacle}`],
      })
    }
    const route = { connectionName: "signal", traceThickness: .1, viaDiameter: .3, route: [start, end], vias: [] }
    const input: ClearancePathInput = {
      srj: { bounds, layerCount, minTraceWidth: .1, connections: [], obstacles,
        allowBlindAndBuriedVias: fixture % 4 === 0, minTraceToHoleEdgeClearance: .025,
        minViaEdgeToPadEdgeClearance: .0375 },
      routes: [route, { ...route, connectionName: "other", route: [
        { x: offset - 2.375, y: -2, z: 0 }, { x: offset + 2.375, y: 2, z: 0 },
        { x: offset + 2.375, y: 2, z: layerCount - 1 },
      ] }],
      routeIndex: 0, start, end, bounds, traceThickness: .1,
      traceClearance: .075, viaClearance: .075, viaHoleDiameter: .15,
      gridSize: fixture % 2 === 0 ? .125 : .25, maxNodes: fixture % 4 === 0 ? 32 : 1536,
      heuristicWeight: fixture % 2 === 0 ? 1 : 3, allowLayerChanges: fixture % 7 !== 0,
    }
    const nativeCalls: string[] = []
    const packedCalls: string[] = []
    const native = new FindClearancePathSolver({ ...input, getAdditionalEdgeCost: (a, b): number => {
      nativeCalls.push(JSON.stringify([a, b]))
      return a.z === b.z && a.y + b.y < -.5 ? .0125 : 0
    } })
    const packed = new Pipeline9DenseClearancePathSolver({ ...input, getAdditionalEdgeCost: (a, b): number => {
      packedCalls.push(JSON.stringify([a, b]))
      return a.z === b.z && a.y + b.y < -.5 ? .0125 : 0
    } })
    while (!native.solved && !native.failed) {
      native.step()
      packed.step()
      expect(packed.stats).toEqual(native.stats)
      expect(packed.solved).toBe(native.solved)
      expect(packed.failed).toBe(native.failed)
    }
    expect(packed.getOutput()).toEqual(native.getOutput())
    expect(packed.iterations).toBe(native.iterations)
    expect(packed.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
    expect(packedCalls).toEqual(nativeCalls)
    if (packed.getOutput()) found++
    if (packed.stats.completionReason === "node-limit") limited++
  }
  expect(found).toBeGreaterThan(0)
  expect(limited).toBeGreaterThan(0)
})
