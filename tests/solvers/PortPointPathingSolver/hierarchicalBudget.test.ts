import { expect, test } from 'bun:test'
import { TinyHyperGraphSolver, type TinyHyperGraphTopology, type TinyHyperGraphProblem } from 'tiny-hypergraph/lib/core'
import { createHierarchicalPortController } from '../../../lib/solvers/PortPointPathingSolver/tinyhypergraph/installHierarchicalPortPotential'

test('hierarchy budget failure is UNKNOWN with partial setup charged and cannot publish solved', (): void => {
  const topology: TinyHyperGraphTopology = {
    portCount: 2, regionCount: 1, regionIncidentPorts: [[0,1]], incidentPortRegion: [[0],[0]],
    regionWidth: new Float64Array([1]), regionHeight: new Float64Array([1]),
    regionCenterX: new Float64Array([0]), regionCenterY: new Float64Array([0]),
    portAngleForRegion1: new Int32Array(2), portX: new Float64Array([0,1]),
    portY: new Float64Array(2), portZ: new Int32Array(2),
  }
  const problem: TinyHyperGraphProblem = {
    routeCount: 1, portSectionMask: new Int8Array(2).fill(1), routeStartPort: new Int32Array([0]),
    routeEndPort: new Int32Array([1]), routeNet: new Int32Array([0]), regionNetId: new Int32Array(1).fill(-1),
  }
  for (const cap of [7,8,12,20,30]) {
    const host = new TinyHyperGraphSolver(topology, problem, { MAX_ITERATIONS: 100 })
    const controller = createHierarchicalPortController(cap)
    controller.install(host)
    host.step()
    expect(host.failed).toBe(true)
    expect(host.solved).toBe(false)
    expect(host.error).toContain('UNKNOWN')
    expect(controller.diagnostics.setupWorkUnits).toBeGreaterThan(0)
    expect(controller.diagnostics.workUnits).toBeLessThanOrEqual(cap)
    expect(controller.diagnostics.budgetExhaustions).toBe(1)
    expect(controller.diagnostics.nativeIterations).toBe(0)
    expect(host.MAX_ITERATIONS).toBe(100)
  }
  expect((): void => { createHierarchicalPortController(50_000_001) }).toThrow()
})
