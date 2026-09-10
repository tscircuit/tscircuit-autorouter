import assert from "node:assert/strict"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import Flatbush from "flatbush"
import { distance, doSegmentsIntersect, pointToSegmentDistance } from "@tscircuit/math-utils"
import { SingleRouteCandidatePriorityQueue, type Node } from "../../../lib/data-structures/SingleRouteCandidatePriorityQueue"
import { HighDensityRouteSpatialIndex } from "../../../lib/data-structures/HighDensityRouteSpatialIndex"
import { cloneAndShuffleArray, seededRandom } from "../../../lib/utils/cloneAndShuffleArray"
import type { HighDensityRoute } from "../../../lib/types/high-density-types"

type Point = { x: number; y: number; z: number }
type Box = [number, number, number, number]
type SpatialCase = {
  routes: HighDensityRoute[]
  cellSize: number
  points: [Point, number][]
  segments: [Point, Point, number][]
  remove: string
  add: HighDensityRoute
}
type Input = {
  queues: [number, number][][]
  flatbush: { boxes: Box[]; queries: Box[] }[]
  spatial: SpatialCase[]
  shuffles: { values: number[]; seed: number }[]
  geometry: [Point, Point, Point, Point][]
  rounds: number[]
}

function makeRoute(id: number): HighDensityRoute {
  const x = (id % 11) - 6
  const y = Math.floor(id / 11) - 3
  const z = id % 2
  return {
    connectionName: `route-${id}`,
    traceThickness: id % 7 === 0 ? 2.4 : 0.15,
    viaDiameter: id % 9 === 0 ? 2.8 : 0.6,
    route: [
      { x, y, z },
      { x: x + 0.75, y: y + 0.5, z, insideJumperPad: id % 5 === 0 },
      { x: x + 1.25, y: y + 0.5, z, insideJumperPad: id % 5 === 0 },
      { x: x + 1.25, y: y + 0.5, z: 1 - z },
    ],
    vias: [{ x: x + 1.25, y: y + 0.5 }],
  }
}

function makeInput(): Input {
  const flatbush = [1, 16, 17, 255, 256, 257, 513].flatMap((count) => {
    const boxes: Box[] = Array.from({ length: count }, (_, i): Box => {
      const x = ((i * 17) % 53) - 28
      const y = ((i * 29) % 47) - 25
      return [x, y, x + (i % 4) * 0.25, y + (i % 3) * 0.5]
    })
    const queries: Box[] = [[-100, -100, 100, 100], [-9, -7, 4, 6], [0, 0, 0, 0], [100, 100, 101, 101]]
    for (let i = 0; i < 25; i++) {
      const x = i - 14
      const y = (i * 7) % 19 - 11
      queries.push([x, y, x + 7, y + 9])
    }
    return [
      { boxes, queries },
      { boxes: boxes.map((_, i): Box => [-2, i - count / 2, -2, i - count / 2]), queries },
      { boxes: boxes.map((): Box => [-1, -1, -1, -1]), queries },
    ]
  })
  const points: [Point, number][] = []
  const segments: [Point, Point, number][] = []
  for (let i = 0; i < 40; i++) {
    const point = { x: i % 13 - 6.5, y: i % 7 - 3.5, z: i % 2 }
    points.push([point, i % 3 === 0 ? 0 : 0.2])
    segments.push([point, { x: point.x + 3, y: point.y - 1, z: i % 4 === 0 ? 1 - point.z : point.z }, 0.25])
  }
  const geometry: [Point, Point, Point, Point][] = [
    [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }],
    [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, { x: 2, y: 0, z: 0 }],
    [{ x: 2, y: 3, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 2, y: 2, z: 0 }],
  ]
  for (let i = 0; i < 100; i++) {
    geometry.push(Array.from({ length: 4 }, (_, j): Point => ({ x: ((i * 17 + j * 3) % 37 - 19) / 8, y: ((i * 13 + j * 7) % 41 - 20) / 8, z: j % 2 })) as [Point, Point, Point, Point])
  }
  return {
    queues: [[], Array.from({ length: 60 }, (_, i): [number, number] => [i, i % 4]), Array.from({ length: 80 }, (_, i): [number, number] => [i, ((i * 17) % 31) - 15])],
    flatbush,
    spatial: [0.5, 1, 2].map((cellSize): SpatialCase => ({ routes: Array.from({ length: 80 }, (_, i) => makeRoute(i)), cellSize, points, segments, remove: "route-7", add: makeRoute(101) })),
    shuffles: [0, 1, 2, 3, 4, 5, 16, 100].flatMap((length) => [0, 1, 2, 5, 23, 123456].map((seed) => ({ values: Array.from({ length }, (_, i) => i), seed }))),
    geometry,
    rounds: [-3.5, -2.5000000000000004, -2.5, -2.4999999999999996, -0.5, -0.1, 0, 0.49999999999999994, 0.5, 1.5, 4503599627370495],
  }
}

function reference(input: Input): unknown {
  const queues = input.queues.map((candidates) => {
    const queue = new SingleRouteCandidatePriorityQueue(candidates.map(([id, cost]): Node => ({ x: id, y: 0, z: 0, g: 0, h: 0, f: cost, parent: null })))
    const observations = []
    for (let turn = 0; turn < candidates.length + 3; turn++) {
      observations.push({ peek: queue.peek()?.x ?? null, top: queue.getTopN(7).map((node) => node.x), dequeue: queue.dequeue()?.x ?? null })
      if (turn === 2) queue.enqueue({ x: 10000, y: 0, z: 0, g: 0, h: 0, f: 1, parent: null })
    }
    return observations
  })
  const flatbush = input.flatbush.map((fixture) => {
    const index = new Flatbush(fixture.boxes.length)
    const ids = fixture.boxes.map((box) => index.add(...box))
    index.finish()
    return { ids, queries: fixture.queries.map((query) => index.search(...query)) }
  })
  const spatial = input.spatial.map((fixture) => {
    const index = new HighDensityRouteSpatialIndex(fixture.routes, fixture.cellSize)
    const states = []
    for (let phase = 0; phase < 3; phase++) {
      if (phase === 1) index.removeRoute(fixture.remove)
      if (phase === 2) index.addRoute(fixture.add)
      states.push({
        points: fixture.points.map(([point, margin]) => index.getConflictingRoutesNearPoint(point, margin).map(({ conflictingRoute, distance }) => ({ connectionName: conflictingRoute.connectionName, distance }))),
        segments: fixture.segments.map(([start, end, margin]) => index.getConflictingRoutesForSegment(start, end, margin).map(({ conflictingRoute, distance }) => ({ connectionName: conflictingRoute.connectionName, distance }))),
      })
    }
    return states
  })
  const shuffles = input.shuffles.map((fixture) => {
    const random = seededRandom(fixture.seed)
    return { values: cloneAndShuffleArray(fixture.values, fixture.seed), random: Array.from({ length: 20 }, () => random()) }
  })
  const geometry = input.geometry.map(([a, b, c, d]) => ({ distance: distance(a, b), pointToSegmentDistance: pointToSegmentDistance(a, b, c), intersects: doSegmentsIntersect(a, b, c, d) }))
  return { queues, flatbush, spatial, shuffles, geometry, rounds: input.rounds.map((value) => ({ value: Math.round(value), negativeZero: Object.is(Math.round(value), -0) })) }
}

const input = makeInput()
const directory = fileURLToPath(new URL("..", import.meta.url))
const process = Bun.spawn(["cargo", "run", "--quiet", "--release", "--manifest-path", resolve(directory, "Cargo.toml"), "--example", "helpers"], { stdin: new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "inherit" })
const output = await new Response(process.stdout).text()
assert.equal(await process.exited, 0, "Native helper parity process failed")
const expected = JSON.parse(JSON.stringify(reference(input)))
assert.deepStrictEqual(JSON.parse(output), expected)
console.log(`Helper parity passed: ${input.flatbush.length} Flatbush trees, ${input.spatial.length} spatial indexes, ${input.queues.length} queues, ${input.shuffles.length} shuffle cases, ${input.geometry.length} geometry cases`)
