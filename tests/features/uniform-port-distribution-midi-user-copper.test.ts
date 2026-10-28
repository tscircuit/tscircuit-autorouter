import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { HighDensityRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"

test("captured MIDI user copper reserves its physical width and rejects an impossible crossing", () => {
  const cases: Array<{ port: PortPoint & { portPointId: string }; nodes: Omit<NodeWithPortPoints, "portPoints">[]; fixed: HighDensityRoute; fits: boolean }> = [
    {
      port: { portPointId: "ce3238_pp5_z1::1", x: -39.38125, y: 20.849999999999998, z: 1, connectionName: "source_net_26_mst2", rootConnectionName: "source_net_26" },
      nodes: [
        { capacityMeshNodeId: "cmn_266__sub_0_2", center: { x: -39.153125, y: 20.2125 }, width: 5.81875, height: 1.2749999999999986 },
        { capacityMeshNodeId: "cmn_269__sub_0_0", center: { x: -39.837500000000006, y: 21.412499999999998 }, width: 6.274999999999999, height: 1.125 },
      ],
      fixed: { connectionName: "source_net_27_fixed_4_6", rootConnectionName: "connectivity_net64", traceThickness: 0.2, viaDiameter: 0.3, vias: [],
        route: [{ x: -38.124, y: 19.66795063917053, z: 1 }, { x: -40.66547339765913, y: 22.209424036829656, z: 1 }] },
      fits: true,
    },
    {
      port: { portPointId: "ce21216_pp0_z0::0", x: -39.860680999999985, y: 21.615975000000002, z: 0, connectionName: "source_net_3_mst16", rootConnectionName: "source_net_3" },
      nodes: [
        { capacityMeshNodeId: "new-cmn_339-479", center: { x: -39.860680999999985, y: 20.915975000000003 }, width: 0.4999999999999858, height: 1.3999999999999986 },
        { capacityMeshNodeId: "new-new-cmn_17-122-22", center: { x: -40.1053405, y: 21.8204875 }, width: 0.9893190000000018, height: 0.4090249999999962 },
      ],
      fixed: { connectionName: "source_net_28_fixed_3_0", rootConnectionName: "connectivity_net65", traceThickness: 0.2, viaDiameter: 0.3, vias: [],
        route: [{ x: -40.71068099999998, y: 20.915975000000003, z: 0 }, { x: -39.12695375164908, y: 22.4997022483509, z: 0 }] },
      fits: false,
    },
  ]
  for (const sample of cases) {
    const nodeWithPortPoints = sample.nodes.map((node) => ({ ...node, portPoints: [{ ...sample.port }] }))
    const inputNodesWithPortPoints: InputNodeWithPortPoints[] = sample.nodes.map((node) => ({
      ...node, availableZ: [0, 1],
      portPoints: [{ ...sample.port, connectionNodeIds: sample.nodes.map((entry) => entry.capacityMeshNodeId) as [string, string], distToCentermostPortOnZ: 0 }],
    }))
    const originalCopper = structuredClone(sample.fixed)
    expect(pointToSegmentDistance(sample.port, sample.fixed.route[0]!, sample.fixed.route[1]!)).toBeLessThan(0.175)
    const solver = new UniformPortDistributionSolver({
      nodeWithPortPoints, inputNodesWithPortPoints, useLayerAwareGeometry: true, layerCount: 2, obstacles: [],
      fixedCopper: {
        routes: [sample.fixed], clearance: 0.15,
        netByConnectionName: new Map([[sample.fixed.rootConnectionName!, "fixed-net"], [sample.port.connectionName, "foreign-net"]]),
        traceWidthByConnectionName: new Map([[sample.port.connectionName, 0.15]]),
      },
    })
    if (sample.fits) {
      solver.solve()
      expect(solver.solved).toBe(true)
      for (const node of solver.getOutput()) {
        expect(pointToSegmentDistance(node.portPoints[0]!, sample.fixed.route[0]!, sample.fixed.route[1]!)).toBeCloseTo(0.325, 12)
      }
    } else {
      expect(() => solver.solve()).toThrow('layer 0 has no space for port "ce21216_pp0_z0::0"')
      expect(solver.solved).toBe(false)
    }
    expect(sample.fixed).toEqual(originalCopper)
  }
})
