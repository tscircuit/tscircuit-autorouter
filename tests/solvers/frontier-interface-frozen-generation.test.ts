import { expect, test } from "bun:test"
import { FrontierIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/FrontierIntraNodeSolver"

test("all future route domains are immutable before any prefix equivalence is used", () => {
  const candidate = new FrontierIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "frozen", center: { x: 0, y: 0 }, width: 6, height: 6, availableZ: [0, 1],
      portPoints: [
        { connectionName: "a", rootConnectionName: "root-a", x: -3, y: 0, z: 0 },
        { connectionName: "a", rootConnectionName: "root-a", x: 3, y: 0, z: 0 },
        { connectionName: "b", rootConnectionName: "root-b", x: 0, y: -3, z: 0 },
        { connectionName: "b", rootConnectionName: "root-b", x: 0, y: 3, z: 0 },
      ],
    }, layerCount: 2, traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.1,
  })
  candidate.step()
  const engine = candidate.engine!
  while (!engine.diagram && !engine.failed) engine.step()
  expect(engine.failed).toBe(false)
  expect(engine.diagram!.iterations).toBe(0)
  const queries = engine.counters.frontierInterfaceDomainQueryCount
  const generated = engine.counters.frontierInterfaceGeneratedDomainChoiceCount
  const domains = structuredClone(engine.domains)
  expect(Object.isFrozen(engine.domains)).toBe(true)
  expect(engine.domains.every((domain) => Object.isFrozen(domain))).toBe(true)
  expect(() => engine.domains[0]!.push(engine.domains[0]![0]!)).toThrow()
  engine.solve()
  expect(engine.solved, engine.error ?? "failed").toBe(true)
  expect(engine.counters.frontierInterfaceDomainQueryCount).toBe(queries)
  expect(engine.counters.frontierInterfaceGeneratedDomainChoiceCount).toBe(generated)
  expect(engine.domains).toEqual(domains)
  expect(engine.paths).toHaveLength(2)
  for (const [task, path] of engine.paths.entries()) {
    expect(path.vertices[0]).toBe(engine.tasks[task]!.start)
    expect(path.vertices.at(-1)).toBe(engine.tasks[task]!.end)
  }
})
