import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { assignCrampedPortCapacityCosts } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/assignCrampedPortCapacityCosts"

test("cramped ports price overflow without cutting connectivity", async () => {
  const ports = Array.from({ length: 16 }, (_, index) => ({
    portId: index === 0 ? "entry" : `entry::dup${index}`,
    region1Id: "left",
    region2Id: "right",
    d: {
      x: 0,
      y: (0.05 * index) / 16,
      z: 0,
      cramped: true,
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
  const ordinary = {
    ...graph,
    ports: graph.ports.map((port) => ({
      ...port,
      d: { ...port.d, cramped: false },
    })),
  }
  expect(assignCrampedPortCapacityCosts(ordinary, 0.1, 0.15)).toEqual(ordinary)
  const before = structuredClone(graph)
  const result = assignCrampedPortCapacityCosts(graph, 0.1, 0.15)
  expect(graph).toEqual(before)
  expect(result.ports.length).toBe(graph.ports.length)
  expect(result.regions).toEqual(graph.regions)
  expect(
    result.ports.every((port) => port.d.crampedBoundaryCapacity === 5),
  ).toBe(true)
  expect(
    new Set(result.ports.map((port) => port.d.crampedBoundaryKey)).size,
  ).toBe(1)
  const ids = new Set(result.ports.map((port) => port.portId))
  for (const region of result.regions) {
    expect(region.pointIds.every((id) => ids.has(id))).toBe(true)
  }
  for (const [index, port] of result.ports.entries()) {
    expect(port.d.x).toBe(graph.ports[index]!.d.x)
    expect(port.d.y).toBe(graph.ports[index]!.d.y)
  }
  const narrow = {
    ...graph,
    regions: graph.regions.map((region) => ({
      ...region,
      d: { ...region.d, height: 0.35 },
    })),
  }
  expect(
    assignCrampedPortCapacityCosts(narrow, 0.1, 0.15).ports.every(
      (port) => port.d.crampedBoundaryCapacity === 2,
    ),
  ).toBe(true)
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
  const layered = assignCrampedPortCapacityCosts(twoLayers, 0.1, 0.15)
  expect(layered.ports.length).toBe(result.ports.length * 2)
  expect(
    new Set(layered.ports.map((port) => port.d.crampedBoundaryKey)).size,
  ).toBe(2)

  const graphics: GraphicsObject = { lines: [], circles: [], texts: [] }
  for (const [index, count] of [1, 5, 8].entries()) {
    const offset = index * 1.8
    graphics.lines!.push({
      points: [
        { x: offset, y: -0.6 },
        { x: offset, y: 0.6 },
      ],
      strokeColor: "#475569",
      strokeWidth: 0.015,
    })
    for (let net = 0; net < count; net++) {
      graphics.lines!.push({
        points: [
          { x: offset - 0.5, y: -0.5 + net * 0.15 },
          { x: offset, y: -0.5 + net * 0.15 },
          { x: offset + 0.5, y: -0.5 + net * 0.15 },
        ],
        strokeColor: count > 5 ? "#d97706" : "#059669",
        strokeWidth: 0.025,
      })
    }
    graphics.texts!.push({
      x: offset,
      y: 1,
      text: `${count} distinct nets / 5 nominal slots`,
      fontSize: 0.1,
    })
    graphics.texts!.push({
      x: offset,
      y: 0.8,
      text: count > 5 ? "Prefer an available detour" : "No overflow preference",
      fontSize: 0.09,
    })
  }
  await expect(graphics).toMatchGraphicsSvg(import.meta.path)
})
