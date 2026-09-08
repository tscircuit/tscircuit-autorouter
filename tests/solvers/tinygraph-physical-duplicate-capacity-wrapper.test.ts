import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { createPhysicalWrapperProblem } from "../fixtures/tinygraph/createPhysicalWrapperProblem"

test("the physical wrapper admits original cramped capacity and reports proposed versus retained duplicates", (): void => {
  for (const withPhysicalClearance of [false, true]) {
    const params = createPhysicalWrapperProblem()
    for (const port of params.graph.ports) port.d.cramped = true
    const firstConnection = params.connections[0]
    const firstSimpleConnection = firstConnection.simpleRouteConnection
    if (!firstSimpleConnection) {
      throw new Error("Duplicate-capacity fixture requires its SRJ connection")
    }
    params.connections.push({
      ...firstConnection,
      connectionId: "route-b",
      simpleRouteConnection: {
        ...firstSimpleConnection,
        name: "route-b",
      },
    })
    const originalPortIds = params.graph.ports.map(
      (port): string => port.d.portId,
    )
    const solver = new TinyHypergraphPortPointPathingSolver({
      ...params,
      physicalClearance: withPhysicalClearance
        ? {
            clearanceIndex: new FixedCopperClearanceIndex({
              rectangles: [],
              layerCount: 1,
              minClearance: 0.1,
            }),
            traceWidth: 0.1,
          }
        : undefined,
    })
    solver.solve()
    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    const proposed = solver.stats.duplicateCongestedPortProposedCount
    expect(proposed).toBeGreaterThan(0)
    expect(solver.stats.duplicateCongestedPortCount).toBe(
      withPhysicalClearance ? 0 : proposed,
    )
    expect(solver.stats.duplicateCongestedPortRejectedCrampedCount).toBe(
      withPhysicalClearance ? proposed : 0,
    )
    const output = solver.getOutput()
    const inputPortIds = new Set(
      output.inputNodeWithPortPoints.flatMap((node): string[] =>
        node.portPoints.map((port): string => port.portPointId),
      ),
    )
    for (const originalId of originalPortIds) {
      expect(inputPortIds.has(originalId)).toBe(true)
    }
    if (withPhysicalClearance) {
      expect(inputPortIds).toEqual(new Set(originalPortIds))
    }
    expect(output.changedPreloadedTraceSections).toEqual([])
    expect(params.graph.ports.map((port): string => port.d.portId)).toEqual(
      originalPortIds,
    )
  }
})
