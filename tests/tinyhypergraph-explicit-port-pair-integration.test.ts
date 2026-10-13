import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { precomputeIntraNodeRouteParams } from "lib/solvers/HighDensitySolver/precomputeIntraNodeRouteParams"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("Tiny declares authoritative regional pairs only for integrated physical routing", (): void => {
  const physicalParams = structuredClone(
    input,
  ) as unknown as HgPortPointPathingSolverParams
  physicalParams.layerCount = 2
  physicalParams.inputSolvedRoutes = []
  physicalParams.flags.USE_PHYSICAL_VIA_COSTS = true
  const explicitlyDisabled = structuredClone(physicalParams)
  explicitlyDisabled.flags.USE_PHYSICAL_VIA_COSTS = false
  const legacy = structuredClone(physicalParams)
  delete legacy.flags.USE_PHYSICAL_VIA_COSTS
  const fourLayer = structuredClone(physicalParams)
  fourLayer.layerCount = 4

  for (const params of [
    physicalParams,
    explicitlyDisabled,
    legacy,
    fourLayer,
  ]) {
    const originalParams = structuredClone(params)
    const solver = new TinyHypergraphPortPointPathingSolver(params)
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.physicalViaMode).toBe(params === physicalParams)
    const nodes = solver.getOutput().nodesWithPortPoints
    expect(nodes.length).toBeGreaterThan(0)
    for (const node of nodes) {
      const precomputed = precomputeIntraNodeRouteParams(node)
      if (params === physicalParams) {
        expect(node.useExplicitPortPointPairs).toBeTrue()
        expect(precomputed.explicitConnectionPairs).toHaveLength(
          node.portPointsInPairs!.length,
        )
        expect(node.portPointsInPairs!.flat()).toEqual(node.portPoints)
      } else {
        expect("useExplicitPortPointPairs" in node).toBeFalse()
        expect(precomputed.explicitConnectionPairs).toBeUndefined()
        expect(precomputed.hasMultipleExplicitConnectionPairs).toBeUndefined()
        expect(precomputed.hasMatchingLinkedConnectionPairs).toBeUndefined()
      }
    }
    expect(params).toEqual(originalParams)
  }
})
