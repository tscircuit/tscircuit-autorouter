import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { createPipeline9StaticSegmentValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9StaticSegmentValidator"
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import fixture from "../fixtures/sample24-uniform-node61553.json"

test("sample24 node61553 moves its illegal bottom midpoint along the exact existing shared edge", (): void => {
  const nodes = structuredClone(fixture.nodes) as NodeWithPortPoints[]
  const inputNodes = structuredClone(
    fixture.inputNodes,
  ) as InputNodeWithPortPoints[]
  const physicalSrj = fixture.physicalSrj as SimpleRouteJson
  const topPort = nodes[2]!.portPoints[0]!,
    bottomPort = nodes[2]!.portPoints[1]!
  expect(fixture.provenance.originalObstacleCount).toBe(4418)
  expect(physicalSrj.obstacles).toHaveLength(6)
  const solver = new UniformPortDistributionSolver({
    physicalSrj,
    layerCount: 8,
    useLayerAwareGeometry: true,
    obstacles: physicalSrj.obstacles,
    nodeWithPortPoints: nodes,
    inputNodesWithPortPoints: inputNodes,
  })
  const validate = createPipeline9StaticSegmentValidator(physicalSrj)
  expect(
    validate({
      start: bottomPort,
      end: bottomPort,
      connectionName: topPort.connectionName,
      traceThickness: 0.1,
      viaDiameter: 0.3,
    }),
  ).toBeFalse()
  solver.solve()
  const output = solver.getOutput(),
    node = output[2]!,
    moved = node.portPoints[1]!
  expect(moved.x).toBeGreaterThan(281.87)
  expect(moved.x).toBeLessThan(281.97565906)
  expect(moved.y).toBe(bottomPort.y)
  expect(output[1]!.portPoints[0]).toEqual(moved)
  expect(node.portPointsInPairs![0]![1]).toEqual(moved)
  expect(node.portPoints[0]!.x).toBeCloseTo(topPort.x, 12)
  expect(moved.portPointId).toBe(bottomPort.portPointId)
  const via = { x: 281.97565806, y: 69.82 }
  const route = [node.portPoints[0]!, { ...via, z: 2 }, { ...via, z: 7 }, moved]
  for (let i = 1; i < route.length; i++)
    expect(
      validate({
        start: route[i - 1]!,
        end: route[i]!,
        connectionName: topPort.connectionName,
        rootConnectionName: topPort.rootConnectionName,
        traceThickness: 0.1,
        viaDiameter: 0.3,
      }),
    ).toBeTrue()
})
