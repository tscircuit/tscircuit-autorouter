import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { constrainDuplicatePortsToSharedEdges } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/constrainDuplicatePortsToSharedEdges"
import type { CapacityMeshNode } from "lib/types"

test("duplicate boundary choices preserve terminals and fit physical clearance", (): void => {
  const nodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "left",
      center: { x: -1, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0],
      layer: "top",
    },
    {
      capacityMeshNodeId: "right",
      center: { x: 1, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0],
      layer: "top",
    },
    {
      capacityMeshNodeId: "corner",
      center: { x: 0.074838, y: 2 },
      width: 0.149676,
      height: 2,
      availableZ: [0],
      layer: "top",
    },
  ]
  const ports: SerializedHyperGraph["ports"] = [
    {
      portId: "wide",
      region1Id: "left",
      region2Id: "right",
      d: { x: 0, y: 0, z: 0, _preloadedFixedNetIds: ["fixed-net"] },
    },
    {
      portId: "wide-extra",
      region1Id: "left",
      region2Id: "right",
      d: { x: 0.01, y: 0.02, z: 0, duplicatedFromPortId: "wide" },
    },
    {
      portId: "narrow",
      region1Id: "right",
      region2Id: "corner",
      d: { x: 0.074838, y: 1, z: 0 },
    },
    {
      portId: "narrow-extra",
      region1Id: "right",
      region2Id: "corner",
      d: { x: 0.05, y: 1.02, z: 0, duplicatedFromPortId: "narrow" },
    },
  ]
  const graph: SerializedHyperGraph = {
    ports,
    regions: nodes.map((node) => ({
      regionId: node.capacityMeshNodeId,
      pointIds: ports
        .filter(
          (port) =>
            port.region1Id === node.capacityMeshNodeId ||
            port.region2Id === node.capacityMeshNodeId,
        )
        .map((port) => port.portId),
      d: node,
    })),
  }
  const original = structuredClone(graph)
  const constrained = constrainDuplicatePortsToSharedEdges({
    graph,
    nodes,
    minPortSpacing: 0.25,
  })
  expect(graph).toEqual(original)
  expect(constrained.ports.find((port) => port.portId === "wide")).toEqual(
    ports[0],
  )
  expect(constrained.ports.find((port) => port.portId === "narrow")).toEqual(
    ports[2],
  )
  const extra = constrained.ports.find((port) => port.portId === "wide-extra")!
  expect(extra.d!.x).toBe(0)
  expect(Math.abs(extra.d!.y)).toBeGreaterThanOrEqual(0.25)
  expect(Math.abs(extra.d!.y)).toBeLessThanOrEqual(0.75)
  expect(
    constrained.ports.some((port) => port.portId === "narrow-extra"),
  ).toBeFalse()
  expect(
    constrained.regions.every(
      (region) => !region.pointIds.includes("narrow-extra"),
    ),
  ).toBeTrue()
  const movable = constrainDuplicatePortsToSharedEdges({
    graph: {
      ...graph,
      ports: graph.ports.map((port) => ({
        ...port,
        d: { ...port.d, _preloadedFixedNetIds: undefined },
      })),
    },
    nodes,
    minPortSpacing: 0.25,
  })
  const wideChoices = movable.ports.filter((port) => port.region1Id === "left")
  expect(wideChoices).toHaveLength(2)
  expect(wideChoices.every((port) => port.d!.x === 0)).toBeTrue()
  expect(
    Math.abs(wideChoices[0]!.d!.y - wideChoices[1]!.d!.y),
  ).toBeGreaterThanOrEqual(0.25)
  expect(
    movable.ports.some((port) => port.portId === "narrow-extra"),
  ).toBeFalse()
  expect(graph).toEqual(original)
})
