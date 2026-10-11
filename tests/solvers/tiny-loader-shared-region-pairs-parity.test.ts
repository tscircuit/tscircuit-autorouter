import { strict as assert } from "node:assert"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import { loadSerializedHyperGraph as candidateLoad } from "tiny-hypergraph/lib/index"

type GraphFactory = (events: string[]) => SerializedHyperGraph
type Port = SerializedHyperGraph["ports"][number]

// An own constructor equal to the native Array constructor preserves species
// behavior and selects the retained original scan. Connections keep that
// selection when obstacle filtering creates a replacement ports array.
function originalLoad(
  graph: SerializedHyperGraph,
): ReturnType<typeof candidateLoad> {
  for (const array of [graph.ports, graph.connections]) {
    if (!array) continue
    Object.defineProperty(array, "constructor", {
      value: Array,
      enumerable: false,
      configurable: true,
      writable: true,
    })
  }
  return candidateLoad(graph)
}

function fixture(): SerializedHyperGraph {
  const ids = ["a|b", "a", "b|c", ""]
  const ports: Port[] = [
    {
      portId: "p0",
      region1Id: ids[0]!,
      region2Id: ids[1]!,
      d: { x: 1, y: 0, z: 0 },
    },
    {
      portId: "p1",
      region1Id: ids[1]!,
      region2Id: ids[2]!,
      d: { x: 2, y: 0, z: 1 },
    },
    {
      portId: "p2",
      region1Id: ids[2]!,
      region2Id: ids[3]!,
      d: { x: 3, y: 0, z: 0 },
    },
    {
      portId: "p3",
      region1Id: ids[0]!,
      region2Id: ids[0]!,
      d: { x: 0, y: 0, z: 0 },
    },
  ]
  const connections = [
    {
      connectionId: "direct",
      startRegionId: ids[0]!,
      endRegionId: ids[1]!,
    },
    {
      connectionId: "reverse",
      startRegionId: ids[1]!,
      endRegionId: ids[0]!,
    },
    {
      connectionId: "routed",
      startRegionId: ids[0]!,
      endRegionId: ids[1]!,
    },
    {
      connectionId: "separate",
      startRegionId: ids[0]!,
      endRegionId: ids[3]!,
    },
    {
      connectionId: "self",
      startRegionId: ids[0]!,
      endRegionId: ids[0]!,
    },
  ]
  return {
    regions: ids.map((regionId, index) => ({
      regionId,
      pointIds: ports
        .filter(
          (port) => port.region1Id === regionId || port.region2Id === regionId,
        )
        .map((port) => port.portId),
      d: {
        center: { x: index, y: 0 },
        width: 1,
        height: 1,
        availableZ: [0, 1],
      },
    })),
    ports,
    connections,
    solvedRoutes: [
      {
        connection: connections[2]!,
        requiredRip: false,
        path: [
          {
            portId: "p0",
            g: 0,
            h: 0,
            f: 0,
            hops: 0,
            ripRequired: false,
            nextRegionId: ids[0]!,
          },
          {
            portId: "p0",
            g: 0,
            h: 0,
            f: 0,
            hops: 1,
            ripRequired: false,
            lastRegionId: ids[0]!,
          },
        ],
      },
    ],
  }
}

test("shared-region pair indexing preserves loader parity", (): void => {
  function check(factory: GraphFactory): void {
    const originalEvents: string[] = []
    const candidateEvents: string[] = []
    const originalGraph = factory(originalEvents)
    const candidateGraph = factory(candidateEvents)
    let original: ReturnType<typeof originalLoad> | undefined
    let candidate: ReturnType<typeof candidateLoad> | undefined
    let originalError: string | undefined
    let candidateError: string | undefined
    try {
      original = originalLoad(originalGraph)
    } catch (error) {
      originalError = String(error)
    }
    try {
      candidate = candidateLoad(candidateGraph)
    } catch (error) {
      candidateError = String(error)
    }
    expect(candidateError).toBe(originalError)
    expect(candidateEvents).toEqual(originalEvents)
    assert.deepStrictEqual(candidate, original)
    if (!candidate || !original) return
    for (const metadata of candidate.problem.routeMetadata ?? []) {
      expect(
        candidateGraph.connections?.some(
          (connection) => connection === metadata,
        ),
      ).toBe(true)
    }
    for (const [field, key] of [
      ["regionMetadata", "serializedRegionId"],
      ["portMetadata", "serializedPortId"],
    ] as const) {
      const actualMetadata = candidate.topology[field] ?? []
      const expectedMetadata = original.topology[field] ?? []
      for (let index = 0; index < actualMetadata.length; index++) {
        expect(
          Object.getOwnPropertyDescriptor(actualMetadata[index]!, key),
        ).toEqual(
          Object.getOwnPropertyDescriptor(expectedMetadata[index]!, key),
        )
      }
    }
  }

  check(fixture)
  check(() => {
    const graph = fixture()
    graph.ports.push({ ...graph.ports[1]!, portId: "p0" })
    graph.ports.push({
      ...graph.ports[0]!,
      region1Id: graph.ports[0]!.region2Id,
      region2Id: graph.ports[0]!.region1Id,
    })
    graph.connections?.push({
      ...graph.connections[3]!,
      connectionId: "duplicate-route",
    })
    return graph
  })
  check(() => {
    const graph = fixture()
    graph.regions.push({
      ...graph.regions[0]!,
      d: { center: { x: 100, y: 100 }, width: 20, height: 20 },
    })
    return graph
  })
  check(() => {
    const graph = fixture()
    graph.regions.push({
      regionId: "obstacle",
      pointIds: ["removed"],
      d: { _containsObstacle: true },
    })
    graph.ports.push({
      portId: "removed",
      region1Id: "obstacle",
      region2Id: graph.regions[3]!.regionId,
      d: { x: 0, y: 0, z: 0 },
    })
    return graph
  })

  for (const field of ["region1Id", "region2Id", "portId"] as const) {
    check((events) => {
      const graph = fixture()
      const port = graph.ports[0]!
      const value = port[field]
      Object.defineProperty(port, field, {
        get: (): string => {
          events.push(`port.${field}`)
          return value
        },
      })
      return graph
    })
  }
  for (const field of [
    "connectionId",
    "startRegionId",
    "endRegionId",
  ] as const) {
    check((events) => {
      const graph = fixture()
      const connection = graph.connections![0]!
      const value = connection[field]
      Object.defineProperty(connection, field, {
        get: (): string => {
          events.push(`connection.${field}`)
          return value
        },
      })
      return graph
    })
  }
  check((events) => {
    const graph = fixture()
    Object.defineProperty(graph.ports[0]!.d, "x", {
      get: (): number => {
        events.push("metadata.x")
        graph.ports[1]!.region1Id = graph.regions[0]!.regionId
        return 1
      },
    })
    return graph
  })
  check((events) => {
    const graph = fixture()
    Object.defineProperty(graph.ports, "filter", {
      value: function (
        this: Port[],
        predicate: (port: Port) => boolean,
      ): Port[] {
        events.push("custom.filter")
        const matched: Port[] = Reflect.apply(Array.prototype.filter, this, [
          predicate,
        ])
        Object.defineProperty(matched, "map", {
          value: (
            mapper: (port: Port) => string,
          ): { readonly length: number } => {
            events.push("custom.map")
            const ids: string[] = Reflect.apply(Array.prototype.map, matched, [
              mapper,
            ])
            return {
              get length(): number {
                events.push("delayed.length")
                return ids.length
              },
            }
          },
        })
        return matched
      },
    })
    return graph
  })
  check((events) => {
    const graph = fixture()
    Object.defineProperty(graph.connections, "map", {
      value: function (
        this: NonNullable<SerializedHyperGraph["connections"]>,
        mapper: (...args: unknown[]) => unknown,
      ): unknown[] {
        events.push("connections.map")
        return Reflect.apply(Array.prototype.map, this, [mapper])
      },
    })
    return graph
  })
  for (const id of [Number.NaN, Number.POSITIVE_INFINITY, 7, undefined]) {
    check(() => {
      const graph = fixture()
      Object.defineProperty(graph.regions[0], "regionId", { value: id })
      for (const port of graph.ports) {
        if (port.region1Id === "a|b") {
          Object.defineProperty(port, "region1Id", { value: id })
        }
        if (port.region2Id === "a|b") {
          Object.defineProperty(port, "region2Id", { value: id })
        }
      }
      for (const connection of graph.connections ?? []) {
        if (connection.startRegionId === "a|b") {
          Object.defineProperty(connection, "startRegionId", { value: id })
        }
        if (connection.endRegionId === "a|b") {
          Object.defineProperty(connection, "endRegionId", { value: id })
        }
      }
      return graph
    })
  }
  check(() => {
    const graph = fixture()
    graph.ports[0]!.region1Id = "missing-port-region"
    return graph
  })
  check(() => {
    const graph = fixture()
    graph.connections![0]!.endRegionId = "missing-connection-region"
    return graph
  })
  check(() => {
    const graph = fixture()
    graph.regions[3]!.pointIds = []
    return graph
  })
  check(() => {
    const graph = fixture()
    graph.regions[0]!.assignments = [
      {
        regionPort1Id: "p0",
        regionPort2Id: "p0",
        connectionId: "missing-assignment",
      },
    ]
    return graph
  })
})
