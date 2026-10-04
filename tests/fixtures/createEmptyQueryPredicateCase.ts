import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import type { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

export const emptyQueryPredicateCases = [
  "missing-segments-and-index",
  "missing-segments-present-index",
  "empty-segments-missing-index",
  "provided-empty-ids",
  "query-bounds-mutates-provided-ids",
  "search-throws-before-bounds",
  "via-empty-segments",
  "empty-segments-with-via-index",
] as const

type CaseName = (typeof emptyQueryPredicateCases)[number]
type Solver = SingleHighDensityRouteSolver
type SolverConstructor = new (
  params: ConstructorParameters<typeof SingleHighDensityRouteSolver>[0],
) => Solver
type Query = NonNullable<Parameters<Solver["isNodeTooCloseToObstacle"]>[3]>
type Segments = Solver["obstacleSegments"]
type Index = NonNullable<ReturnType<Solver["obstacleIndexByLayer"]["get"]>>
export type PredicateObservation = {
  events: string[]
  result: boolean | null
  error: string | null
}

const apply = Reflect.apply
const nativeIterator = Array.prototype[Symbol.iterator]

export function createEmptyQueryPredicateCase(
  Constructor: SolverConstructor,
  name: CaseName,
): PredicateObservation {
  const solver = new Constructor({
    connectionName: "current",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    A: { x: -1, y: 0, z: 0 },
    B: { x: 1, y: 0, z: 0 },
  })
  const events: string[] = []
  const via = name === "via-empty-segments"
  const indexedSegments: Segments | undefined = name.startsWith("missing-")
    ? undefined
    : []
  const ids: number[] = []
  const providedIds =
    name === "provided-empty-ids" ||
    name === "query-bounds-mutates-provided-ids"
  const presentIndex =
    name === "missing-segments-present-index" ||
    name === "search-throws-before-bounds"
  const index: Index | undefined = presentIndex
    ? ({
        search(...bounds: number[]): number[] {
          events.push(`segment-search:${bounds.join(",")}`)
          if (name === "search-throws-before-bounds") {
            throw new Error("original segment search failure")
          }
          return undefined as unknown as number[]
        },
      } as unknown as Index)
    : undefined
  solver.obstacleSegmentsByLayer.get = function (): Segments | undefined {
    events.push("segments-map.get")
    return indexedSegments
  }
  solver.obstacleIndexByLayer.get = function (): Index | undefined {
    events.push("index-map.get")
    return index
  }
  Object.defineProperty(solver, "obstacleSegments", {
    get(): unknown[] {
      events.push("obstacleSegments")
      return []
    },
  })
  Object.defineProperty(solver, "obstacleIndex", {
    get(): null {
      events.push("obstacleIndex")
      return null
    },
  })
  Object.defineProperty(solver, "obstacleViaIndex", {
    get(): unknown {
      events.push("obstacleViaIndex")
      if (name !== "empty-segments-with-via-index") return null
      return {
        search(...bounds: number[]): number[] {
          events.push(`via-search:${bounds.join(",")}`)
          return []
        },
      }
    },
  })
  const query = {} as Query
  for (const key of [
    "segments",
    "segmentIds",
    "segmentBounds",
    "pointQueryProximity",
  ]) {
    Object.defineProperty(query, key, {
      get(): unknown {
        events.push(`query.${key}`)
        if (key === "segments") return indexedSegments
        if (key === "segmentIds") return providedIds ? ids : undefined
        if (
          key === "segmentBounds" &&
          name === "query-bounds-mutates-provided-ids"
        ) {
          ids.push(77)
        }
        return undefined
      },
    })
  }
  const node: Node = {
    x: 0.25,
    y: -0.5,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  }
  const iteratorDescriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    Symbol.iterator,
  )!
  let result: boolean | null = null
  let error: string | null = null
  try {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      ...iteratorDescriptor,
      value(this: unknown[]): ArrayIterator<unknown> {
        events.push(
          `array-iterator:${this === ids ? "provided" : "other"}:${this.length}`,
        )
        return apply(nativeIterator, this, [])
      },
    })
    result = solver.isNodeTooCloseToObstacle(
      node,
      undefined,
      via,
      via ? undefined : query,
    )
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, iteratorDescriptor)
  }
  return { events, result, error }
}
