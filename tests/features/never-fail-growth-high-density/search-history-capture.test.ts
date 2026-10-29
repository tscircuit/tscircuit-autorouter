import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import nodeJson from "../../fixtures/srj18-sample15-sub-via-node.json"

const inputNode: NodeWithPortPoints = nodeJson

test("grow/shrink releases failed searches when capture is disabled without changing routes or failure diagnostics", (): void => {
  for (const maxGrowthAttempts of [undefined, 3]) {
    const solvers = [undefined, true, false].map((captureSearchDebug) => {
      const node = structuredClone(inputNode)
      const originalNode = structuredClone(node)
      const solver = new GrowShrinkHighDensityIntraNodeSolver({
        nodeWithPortPoints: node,
        viaDiameter: 0.3,
        traceWidth: 0.1,
        obstacleMargin: 0.15,
        effort: 1,
        layerCount: 4,
        fallbackToInvalidGeometryOnFailure: false,
        cacheProvider: null,
        maxGrowthAttempts,
        captureSearchDebug,
      })
      solver.solve()
      expect(node).toEqual(originalNode)
      return solver
    })
    const [defaultCapture, enabled, disabled] = solvers
    expect(defaultCapture!.failedSolvers.length).toBeGreaterThan(0)
    expect(enabled!.failedSolvers.length).toBe(
      defaultCapture!.failedSolvers.length,
    )
    expect(disabled!.failedSolvers).toHaveLength(0)

    for (const solver of solvers) {
      expect(solver.solved).toBe(maxGrowthAttempts === undefined)
      expect(solver.failed).toBe(maxGrowthAttempts !== undefined)
      expect(solver.activeSubSolver).toBeNull()
      expect(solver.solvedRoutes).toEqual(defaultCapture!.solvedRoutes)
      expect(solver.error).toBe(defaultCapture!.error)
      expect(solver.iterations).toBe(defaultCapture!.iterations)
      expect(solver.growthAttempts).toBe(defaultCapture!.growthAttempts)
      expect(solver.scaleFactor).toBe(defaultCapture!.scaleFactor)
      expect(solver.stats).toEqual(defaultCapture!.stats)
      expect(solver.winningSolver?.solvedRoutes).toEqual(
        defaultCapture!.winningSolver?.solvedRoutes,
      )
    }

    if (maxGrowthAttempts === undefined) {
      expect(disabled!.solvedRoutes).toHaveLength(3)
      expect(disabled!.scaleFactor).toBe(16)
      expect(disabled!.error).toBeNull()
      for (const route of disabled!.solvedRoutes) {
        expect(route.traceThickness).toBe(0.1)
        expect(route.viaDiameter).toBe(0.3)
        for (const endpoint of [route.route[0]!, route.route.at(-1)!]) {
          expect(
            inputNode.portPoints.some(
              (port) =>
                port.connectionName === route.connectionName &&
                port.z === endpoint.z &&
                Math.abs(port.x - endpoint.x) < 1e-8 &&
                Math.abs(port.y - endpoint.y) < 1e-8,
            ),
          ).toBeTrue()
        }
      }
    } else {
      expect(disabled!.solvedRoutes).toHaveLength(0)
      expect(disabled!.scaleFactor).toBe(8)
      expect(disabled!.error).toContain("resizing to 8x")
    }
  }
})
