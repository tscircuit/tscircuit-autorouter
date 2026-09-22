import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { fitDuplicatePortsToSharedBoundary } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/fitDuplicatePortsToSharedBoundary"

test("duplicate ports use available boundary space instead of increasing capacity at one point", async () => {
  const ports = Array.from({ length: 16 }, (_, index) => ({
    portId: index === 0 ? "entry" : `entry::dup${index}`,
    region1Id: "left",
    region2Id: "right",
    d: {
      x: 0,
      y: (0.05 * index) / 16,
      z: 0,
      ...(index === 0 ? {} : { duplicatedFromPortId: "entry" }),
    },
  }))
  const graph: SerializedHyperGraph = {
    regions: [-0.5, 0.5].map((x, index) => ({
      regionId: index === 0 ? "left" : "right",
      pointIds: ports.map((port) => port.portId),
      d: { center: { x, y: 0 }, width: 1, height: 1.2 },
    })),
    ports,
  }
  const before = structuredClone(graph)
  const result = fitDuplicatePortsToSharedBoundary(graph, 0.1, 0.15)
  expect(graph).toEqual(before)
  expect(result.ports[0]).toEqual(graph.ports[0])
  expect(result.ports.length).toBeGreaterThan(1)
  expect(result.ports.length).toBeLessThanOrEqual(5)
  const ids = new Set(result.ports.map((port) => port.portId))
  for (const region of result.regions) {
    expect(region.pointIds.every((id) => ids.has(id))).toBe(true)
  }
  for (const [index, port] of result.ports.entries()) {
    expect(port.d.x).toBe(0)
    expect(Math.abs(port.d.y)).toBeLessThanOrEqual(0.55)
    for (const other of result.ports.slice(index + 1)) {
      expect(Math.abs(port.d.y - other.d.y)).toBeGreaterThanOrEqual(0.25 - 1e-9)
    }
  }
  const narrow = {
    ...graph,
    regions: graph.regions.map((region) => ({
      ...region,
      d: { ...region.d, height: 0.35 },
    })),
  }
  expect(fitDuplicatePortsToSharedBoundary(narrow, 0.1, 0.15).ports).toEqual([
    ports[0]!,
  ])
  const twoLayers = {
    ...graph,
    ports: [
      ...graph.ports,
      ...graph.ports.map((port, index) => ({
        ...port,
        portId: `${port.portId}-z1`,
        d: {
          ...port.d,
          z: 1,
          ...(index === 0 ? {} : { duplicatedFromPortId: "entry-z1" }),
        },
      })),
    ],
  }
  twoLayers.regions = graph.regions.map((region) => ({
    ...region,
    pointIds: twoLayers.ports.map((port) => port.portId),
  }))
  expect(
    fitDuplicatePortsToSharedBoundary(twoLayers, 0.1, 0.15).ports.length,
  ).toBe(result.ports.length * 2)

  const graphics: GraphicsObject = { lines: [], circles: [], texts: [] }
  for (const [index, output] of [graph, result].entries()) {
    const offset = index * 2.8
    graphics.lines!.push({
      points: [
        { x: offset, y: -0.6 },
        { x: offset, y: 0.6 },
      ],
      strokeColor: "#475569",
      strokeWidth: 0.015,
    })
    for (const port of output.ports) {
      graphics.circles!.push({
        center: { x: offset, y: port.d.y },
        radius: 0.05,
        fill:
          index === 0 ? "rgba(220,38,38,0.45)" : "rgba(5,150,105,0.65)",
      })
    }
    graphics.texts!.push({
      x: offset,
      y: 1,
      text:
        index === 0
          ? "Before: 16 ports in 0.05 mm"
          : `After: ${output.ports.length} ports, >=0.25 mm pitch`,
      fontSize: 0.12,
    })
  }
  await expect(graphics).toMatchGraphicsSvg(import.meta.path)
})
