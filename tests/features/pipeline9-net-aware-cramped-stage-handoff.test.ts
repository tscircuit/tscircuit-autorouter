import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { createAvailableNetAwareCrampedPorts } from "../fixtures/availableNetAwareCrampedPorts"

test("Pipeline9 prepares canonical cramped sites only for original-preload-free input at the real Available boundary", (): void => {
  for (const hasPreload of [false, true]) {
    const fixture = createAvailableNetAwareCrampedPorts()
    const srj = structuredClone(fixture.srj)
    if (hasPreload) {
      srj.traces = [
        {
          type: "pcb_trace",
          pcb_trace_id: "existing-ordinary-copper",
          connection_name: "route-net",
          connectsTo: ["route-b", "route-a"],
          route: [
            { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.25 },
            { route_type: "wire", x: 1, y: 1, layer: "top", width: 0.25 },
          ],
        },
      ]
    }
    const inputBefore = structuredClone(srj)
    const nodesBefore = structuredClone(fixture.input.nodes)
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
      cacheProvider: null,
    })
    const sourceBefore = structuredClone(pipeline.originalSrj)
    pipeline.capacityNodes = fixture.input.nodes
    pipeline.capacityEdges = fixture.input.edges
    pipeline.srjWithPointPairs = structuredClone(srj)
    for (const connection of pipeline.srjWithPointPairs.connections) {
      const originalName = connection.name
      connection.name = `${originalName}_mst0`
      connection.rootConnectionName = originalName
      pipeline.connMap.addConnections([[originalName, connection.name]])
    }
    const routingBefore = structuredClone(pipeline.srjWithPointPairs)
    const context = pipeline["createPhysicalCrampedPortContext"]()
    if (hasPreload) {
      expect(context).toBeUndefined()
    } else {
      expect(context).toBeDefined()
      if (context === undefined) {
        throw new Error("Generated copper requires its physical context")
      }
      expect(context.traceWidth).toBe(0.25)
      expect(context.traceGap).toBe(0.1)
      expect(context.padGap).toBe(0.15625)
      expect(context.layerCount).toBe(2)
      expect(context.routableNetIds.size).toBe(3)
      for (const connection of pipeline.srjWithPointPairs.connections) {
        const canonical = pipeline.connMap.getNetConnectedToId(connection.name)
        expect(canonical).toBe(
          pipeline.connMap.getNetConnectedToId(connection.rootConnectionName!),
        )
        expect(context.routableNetIds.has(canonical!)).toBeTrue()
      }
      expect([...context.rectangles[0]!.ownerNetIds]).toEqual([
        pipeline.connMap.getNetConnectedToId("route-net_mst0")!,
      ])
    }
    const availableIndex = pipeline.pipelineDef.findIndex(
      (step): boolean => step.solverName === "availableSegmentPointSolver",
    )
    const necessaryIndex = pipeline.pipelineDef.findIndex(
      (step): boolean => step.solverName === "necessaryCrampedPortPointSolver",
    )
    expect(availableIndex).toBeGreaterThanOrEqual(0)
    expect(necessaryIndex).toBe(availableIndex + 1)
    pipeline.currentPipelineStepIndex = availableIndex
    while (
      !pipeline.failed &&
      !pipeline.solved &&
      pipeline.currentPipelineStepIndex < necessaryIndex
    ) {
      pipeline.step()
    }
    expect(pipeline.failed).toBeFalse()
    expect(pipeline.solved).toBeFalse()
    expect(pipeline.currentPipelineStepIndex).toBe(necessaryIndex)
    expect(pipeline.portPointPathingSolver).toBeUndefined()
    const actual = pipeline.availableSegmentPointSolver!
    expect(actual.solved).toBeTrue()
    const legacy = new AvailableSegmentPointSolver({
      ...fixture.input,
      physicalCrampedPortContext: undefined,
    })
    legacy.solve()
    if (hasPreload) {
      expect(actual.getOutput()).toEqual(legacy.getOutput())
    } else {
      const left = actual.edgeSegmentMap.get("left-turn")!
      const topPorts = left.portPoints.filter(
        (port): boolean => port.availableZ[0] === 0,
      )
      expect(topPorts).toHaveLength(2)
      expect(topPorts[0]!.y).toBeLessThan(0.46875)
      expect(topPorts[1]!.y).toBeGreaterThan(0.53125)
      expect(topPorts[1]!.y - topPorts[0]!.y).toBeGreaterThanOrEqual(
        0.25 + 0.1,
      )
      for (const port of topPorts) {
        const allowed = context!.clearanceIndex.getAllowedNetIdsAtPoint({
          point: { x: port.x, y: port.y, z: 0 },
          copperDiameter: context!.traceWidth,
        })
        expect(allowed).not.toBeNull()
        expect(
          [...allowed!].some(
            (netId): boolean => context!.routableNetIds.has(netId),
          ),
        ).toBeTrue()
      }
      expect(
        left.portPoints.filter((port): boolean => port.availableZ[0] === 1),
      ).toEqual(
        legacy.edgeSegmentMap
          .get("left-turn")!
          .portPoints.filter((port): boolean => port.availableZ[0] === 1),
      )
    }
    expect(fixture.input.nodes).toEqual(nodesBefore)
    expect(srj).toEqual(inputBefore)
    expect(pipeline.originalSrj).toEqual(sourceBefore)
    expect(pipeline.srjWithPointPairs).toEqual(routingBefore)
  }
})
