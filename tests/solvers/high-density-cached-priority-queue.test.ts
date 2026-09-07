import { expect, test } from "bun:test"
import { SingleRouteCandidatePriorityQueue, type Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("cached priorities preserve heap ties, growth, reuse and complete routing searches", () => {
  const native = new SingleRouteCandidatePriorityQueue<Node>([])
  const cached = new SingleRouteCandidatePriorityQueue<Node>([], { cachePriorities: true })
  let seed = 94823
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let i = 0; i < 1400; i++) {
      const f = i % 29 === 0 ? Infinity : Math.floor(random() * 12)
      const node: Node = { x: i, y: cycle, z: 0, g: 0, h: f, f, parent: null }
      native.enqueue(node)
      cached.enqueue(node)
      if (i % 3 === 0) expect(cached.dequeue()).toBe(native.dequeue())
      expect(cached.peek()).toBe(native.peek())
    }
    while (native.peek()) expect(cached.dequeue()).toBe(native.dequeue())
    expect(cached.dequeue()).toBe(null)
  }

  for (let sample = 0; sample < 8; sample++) {
    const options = {
      connectionName: "route",
      obstacleRoutes: [{
        connectionName: "obstacle",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [{ x: -0.5, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }],
        vias: [{ x: 0, y: 0 }],
      }],
      minDistBetweenEnteringPoints: 0.15,
      bounds: { minX: -2.003, minY: -2.001, maxX: 2.003, maxY: 2.001 },
      A: { x: -2.003, y: -0.5 + random(), z: 0 },
      B: { x: 2.003, y: -0.5 + random(), z: sample % 2 },
      availableZ: [0, 1],
      futureConnections: [{
        connectionName: "future",
        points: [{ x: 0, y: -2.001, z: 0 }, { x: 0, y: 2.001, z: 1 }],
      }],
    }
    const first = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(options)
    const second = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost(options)
    const initial = first.candidates.peek()!
    first.candidates = new SingleRouteCandidatePriorityQueue([initial])
    first.solve()
    second.solve()
    expect({ solved: second.solved, failed: second.failed, iterations: second.iterations,
      route: second.solvedPath, explored: second.debug_exploredNodesOrdered,
    }).toEqual({ solved: first.solved, failed: first.failed, iterations: first.iterations,
      route: first.solvedPath, explored: first.debug_exploredNodesOrdered,
    })
  }
})
