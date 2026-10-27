import { expect, test } from "bun:test"
import { coarsenPipeline9OrdinaryNodes } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/coarsenPipeline9OrdinaryNodes"
import { createFlexibleBoundaryFixture } from "./flexibleBoundaryFixture"

test("ordinary-cell union rejects terminal seams, third owners and mismatched flow identities", (): void => {
  const terminal = createFlexibleBoundaryFixture()
  terminal[0]!.portPoints[1]!.pcb_port_id = "physical-seam"
  const thirdOwner = createFlexibleBoundaryFixture()
  thirdOwner.push({
    ...structuredClone(thirdOwner[0]!),
    capacityMeshNodeId: "third-owner",
    center: { x: 9, y: 9 },
  })
  for (const point of thirdOwner[2]!.portPoints) {
    point.connectionName = "a-different-global-flow"
  }
  const changedLayer = createFlexibleBoundaryFixture()
  changedLayer[1]!.portPoints[0]!.z = 1
  const changedRoot = createFlexibleBoundaryFixture()
  changedRoot[1]!.portPoints[0]!.rootConnectionName = "unrelated-root"
  const reversed = createFlexibleBoundaryFixture()
  reversed[1]!.portPointsInPairs![0]!.reverse()
  const duplicatePair = createFlexibleBoundaryFixture()
  duplicatePair[1]!.portPointsInPairs![1] =
    duplicatePair[1]!.portPointsInPairs![0]!
  const closedCycle = createFlexibleBoundaryFixture()
  const cycleStart = {
    ...closedCycle[0]!.portPoints[1]!,
    y: -0.7,
    portPointId: "cycle-start",
  }
  const cycleEnd = { ...cycleStart, y: 0.7, portPointId: "cycle-end" }
  closedCycle[0]!.portPointsInPairs!.push([cycleStart, cycleEnd])
  closedCycle[1]!.portPointsInPairs!.push([{ ...cycleEnd }, { ...cycleStart }])
  for (const node of closedCycle)
    node.portPoints = node.portPointsInPairs!.flat()
  for (const nodes of [
    terminal,
    thirdOwner,
    changedLayer,
    changedRoot,
    reversed,
    duplicatePair,
    closedCycle,
  ]) {
    const before = structuredClone(nodes)
    const result = coarsenPipeline9OrdinaryNodes({
      nodes,
      hasPreloadedTraces: false,
      physicalTerminals: [],
    })
    expect(result.stats.mergedPairCount).toBe(0)
    expect(result.nodes).toEqual(before)
    expect(nodes).toEqual(before)
  }
})
