import { expect, test } from "bun:test"
import Flatbush from "flatbush"
import type { ConnectionPoint } from "lib/types"
import type { RegionHg } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { createTinyRouteNetIndexer } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createTinyRouteNetIndexer"
import { getRegionNetIdByRegionId } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getRegionNetIdByRegionId"
import { getRegionNetIdByRegionId as originalRegionNetIds } from "../fixtures/get-region-net-id-original"

type Params = Parameters<typeof getRegionNetIdByRegionId>[0]["params"]

function region(
  regionId: string,
  x: number,
  y: number,
  width = 1,
  height = 1,
  availableZ = [0, 1],
): RegionHg {
  return {
    regionId,
    ports: [],
    d: {
      capacityMeshNodeId: regionId,
      center: { x, y },
      width,
      height,
      layer: "top",
      availableZ,
    },
  }
}

function params(regions: RegionHg[], pointGroups: ConnectionPoint[][]): Params {
  return {
    graph: { regions, ports: [] },
    connections: pointGroups.map((pointsToConnect, index) => ({
      connectionId: `connection-${index}`,
      mutuallyConnectedNetworkId: `net-${index % 3}`,
      startRegion: regions[0],
      endRegion: regions[regions.length - 1],
      simpleRouteConnection: {
        name: `connection-${index}`,
        pointsToConnect,
      },
    })),
    layerCount: 2,
    effort: 1,
    flags: { FORCE_CENTER_FIRST: false, RIPPING_ENABLED: true },
    weights: {},
  } as unknown as Params
}

function compare(input: Params): [string, number][] {
  const calls: string[][] = [[], []]
  const baselineIndexer = createTinyRouteNetIndexer()
  const candidateIndexer = createTinyRouteNetIndexer()
  const baseline = originalRegionNetIds({
    params: input,
    getNetIndex: (metadata) => {
      calls[0]!.push(metadata.connectionId)
      return baselineIndexer(metadata)
    },
  })
  const candidate = getRegionNetIdByRegionId({
    params: input,
    getNetIndex: (metadata) => {
      calls[1]!.push(metadata.connectionId)
      return candidateIndexer(metadata)
    },
    useRegionSpatialIndex: true,
  })
  expect([...candidate]).toEqual([...baseline])
  expect(calls[1]).toEqual(calls[0])
  return [...candidate]
}

test("region lookup preserves ordered ownership and callbacks", () => {
  const nativeSearch = Flatbush.prototype.search
  let searches = 0
  Flatbush.prototype.search = function (
    this: Flatbush,
    ...args: Parameters<Flatbush["search"]>
  ): number[] {
    searches++
    return nativeSearch.apply(this, args)
  }
  try {
    const regions = [
      region("resumed", 0, 0),
      region("target", 0, 0),
      region("other-layer", 0, 0, 1, 1, [1]),
      region("alias", 20, 20),
      region("ambiguous", 5, 5),
      region("duplicate", -5, -5),
      region("duplicate", -5, -5),
    ]
    regions[1]!.d._containsTarget = true
    regions[3]!.d._connectedTo = ["connection-0", "net-0"]
    const ownership = compare(
      params(regions, [
        [
          { x: 0, y: 0, layer: "top" },
          { x: 5, y: 5, layer: "top", pcb_port_id: "a" },
          { x: -5, y: -5, layers: ["top", "bottom"], pcb_port_id: "b" },
        ],
        [{ x: 5, y: 5, layer: "top", pcb_port_id: "c" }],
      ]),
    )
    expect(ownership).toEqual([
      ["resumed", -1],
      ["target", 0],
      ["duplicate", 0],
      ["alias", 0],
    ])
    expect(searches).toBe(4)

    let seed = 18
    const allRegions: RegionHg[] = []
    const allPoints: ConnectionPoint[][] = []
    for (let index = 0; index < 96; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const x = ((seed >>> 8) % 1000) - 500
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const y = ((seed >>> 8) % 1000) - 500
      const width = [0, 1e-170, 1, 10][index % 4]!
      allRegions.push(region(`random-${index}`, x, y, width))
      allPoints.push([
        { x, y, layer: "top", pcb_port_id: `inside-${index}` },
        {
          x: x + width / 2 + 0.0009999,
          y,
          layer: "top",
          pcb_port_id: `near-${index}`,
        },
        {
          x: x + width / 2 + 0.0010001,
          y,
          layer: "top",
          pcb_port_id: `outside-${index}`,
        },
        {
          x: x + width / 2 + 0.0008,
          y: y + 0.5008,
          layers: ["top", "bottom"],
          pcb_port_id: `corner-${index}`,
        },
      ])
    }
    compare(params(allRegions, allPoints))
    compare(
      params(
        [region("large", 1e9 - 0.501, -1e9 + 0.501)],
        [{ x: 1e9, y: -1e9 + 0.501, layer: "top", pcb_port_id: "edge" }].map(
          (point) => [point],
        ),
      ),
    )

    for (const coordinate of [NaN, Infinity, -Infinity, 1e155]) {
      const before = searches
      compare(
        params(
          [region("unsafe", coordinate, 0)],
          [[{ x: 0, y: 0, layer: "top" }]],
        ),
      )
      expect(searches).toBe(before)
    }
    const negativeWidth = region("negative", 0, 0, -1)
    const beforeNegative = searches
    compare(params([negativeWidth], [[{ x: 0, y: 0, layer: "top" }]]))
    expect(searches).toBe(beforeNegative)

    const accessorRun = (
      original: boolean,
    ): { output: [string, number][]; reads: number } => {
      const node = region("accessor", 0, 0)
      let reads = 0
      Object.defineProperty(node.d, "width", {
        get: () => {
          reads++
          return 1
        },
      })
      const input = params([node], [[{ x: 0, y: 0, layer: "top" }]])
      const solve = original ? originalRegionNetIds : getRegionNetIdByRegionId
      const options = {
        params: input,
        getNetIndex: createTinyRouteNetIndexer(),
        useRegionSpatialIndex: true,
      }
      return {
        output: [...solve(options)],
        reads,
      }
    }
    expect(accessorRun(false)).toEqual(accessorRun(true))

    const layerCallbackRun = (original: boolean): [string, number][] => {
      const a = region("first", 0, 0)
      const b = region("moved", 100, 100)
      a.d.availableZ.includes = function (z): boolean {
        b.d.center = { x: 0, y: 0 }
        return Array.prototype.includes.call(this, z)
      }
      const input = params(
        [a, b],
        [[{ x: 0, y: 0, layer: "top", pcb_port_id: "p" }]],
      )
      const solve = original ? originalRegionNetIds : getRegionNetIdByRegionId
      const options = {
        params: input,
        getNetIndex: createTinyRouteNetIndexer(),
        useRegionSpatialIndex: true,
      }
      return [...solve(options)]
    }
    expect(layerCallbackRun(false)).toEqual(layerCallbackRun(true))
    expect(layerCallbackRun(false)).toEqual([
      ["first", 0],
      ["moved", 0],
    ])

    const netCallbackRun = (original: boolean): [string, number][] => {
      const node = region("callback", 100, 100)
      const input = params(
        [node],
        [[{ x: 0, y: 0, layer: "top", pcb_port_id: "p" }]],
      )
      const solve = original ? originalRegionNetIds : getRegionNetIdByRegionId
      return [
        ...solve({
          params: input,
          getNetIndex: () => {
            node.d.center = { x: 0, y: 0 }
            return 0
          },
        }),
      ]
    }
    expect(netCallbackRun(false)).toEqual(netCallbackRun(true))
  } finally {
    Flatbush.prototype.search = nativeSearch
  }
})
