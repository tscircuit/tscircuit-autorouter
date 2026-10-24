import { expect, test } from "bun:test"
import { FindClearancePathSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/FindClearancePathSolver"
import { createMeshInput } from "../fixtures/constrained-corridor-mesh-fixture"

test("zero-price native straight witnesses avoid CDT without pretending they consume heap pops", (): void => {
  for (const kind of ["free", "priced", "blocked", "layers"] as const) {
    const input = createMeshInput()
    input.maxNodes = 1
    let prices = 0
    input.getAdditionalEdgeCost = (): number => { prices++; return kind === "priced" ? 0.5 : 0 }
    if (kind === "blocked") input.srj.obstacles.push({
      type: "rect", obstacleId: "fixed", center: { x: 0, y: 0 }, width: 0.4, height: 0.8, zLayers: [0], layers: ["top"], connectedTo: [],
    })
    if (kind === "layers") {
      input.srj.layerCount = 2
      input.allowLayerChanges = true
      input.end.z = 1
    }
    const child = new FindClearancePathSolver(input)
    while (!child.solved && !child.failed) child.step()
    expect(child.failed).toBe(false)
    const stats = child.stats as typeof child.stats & Record<string, number | string>
    if (kind === "free") {
      expect(child.getOutput()).toEqual([input.start, input.end])
      expect(stats.meshStraightWitnessAccepted).toBe(1)
      expect(stats.meshConstructionWork).toBeUndefined()
      expect(stats.nodesPopped).toBe(0)
      expect(prices).toBe(1)
    } else {
      expect(stats.meshStraightWitnessAccepted).toBe(0)
      expect(stats.meshConstructionWork).toBeGreaterThan(0)
      expect(stats.nodesPopped).toBe(1)
      expect(stats.completionReason).toBe("node-limit")
      expect(child.getOutput()).toBeNull()
      if (kind === "blocked") expect(stats.meshStraightWitnessPriceChecks).toBe(0)
      if (kind === "layers") expect(stats.meshStraightWitnessChecks).toBe(0)
    }
  }
})
