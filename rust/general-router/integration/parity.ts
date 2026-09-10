import { deepStrictEqual } from "node:assert"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { IntraNodeRouteSolver } from "../../../lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { NodeWithPortPoints } from "../../../lib/types/high-density-types"
import srj18Node12 from "./fixtures/srj18-12-cmn57.json"
import srj18Node16 from "./fixtures/srj18-16-cmn193.json"

type Props = ConstructorParameters<typeof IntraNodeRouteSolver>[0]
type Fixture = { name: string; props: Props; maxIterations?: number }
type Run = { name: string; trace: unknown[] }

const node = (portPoints: NodeWithPortPoints["portPoints"]): NodeWithPortPoints => ({
  capacityMeshNodeId: "parity-node",
  center: { x: 0, y: 0 },
  width: 3,
  height: 3,
  portPoints,
  availableZ: [0, 1],
})

const crossing = node([
  { connectionName: "a", x: -1.5, y: 0, z: 0 },
  { connectionName: "a", x: 1.5, y: 0, z: 0 },
  { connectionName: "b", x: 0, y: -1.5, z: 0 },
  { connectionName: "b", x: 0, y: 1.5, z: 0 },
])

const fixtures: Fixture[] = [
  {
    name: "replayed-srj18-12-cmn57",
    props: { nodeWithPortPoints: srj18Node12, traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.15 },
  },
  {
    name: "replayed-srj18-16-cmn193",
    props: { nodeWithPortPoints: srj18Node16, traceWidth: 0.15, viaDiameter: 0.3, obstacleMargin: 0.15 },
  },
  { name: "crossing-two-nets", props: { nodeWithPortPoints: crossing } },
  {
    name: "four-layers",
    props: {
      nodeWithPortPoints: {
        ...node([
          { connectionName: "a", x: -1.5, y: -0.5, z: 2 },
          { connectionName: "a", x: 1.5, y: 0.5, z: 3 },
        ]),
        availableZ: [0, 1, 2, 3],
      },
    },
  },
  {
    name: "different-layers",
    props: {
      nodeWithPortPoints: node([
        { connectionName: "a", x: -1.5, y: -0.5, z: 0 },
        { connectionName: "a", x: 1.5, y: 0.5, z: 1 },
      ]),
    },
  },
  {
    name: "multiple-branches",
    props: {
      nodeWithPortPoints: node([
        { connectionName: "tree", rootConnectionName: "root", x: -1.5, y: 0, z: 0 },
        { connectionName: "tree", rootConnectionName: "root", x: 1.5, y: 0, z: 0 },
        { connectionName: "tree", rootConnectionName: "root", x: 0, y: 1.5, z: 0 },
      ]),
    },
  },
  {
    name: "duplicate-endpoints",
    props: {
      nodeWithPortPoints: node([
        { connectionName: "a", x: -1.5, y: 0, z: 0 },
        { connectionName: "a", x: -1.5, y: 0, z: 0 },
        { connectionName: "a", x: 1.5, y: 0, z: 0 },
        { connectionName: "a", x: 1.5, y: 0, z: 0 },
      ]),
    },
  },
  {
    name: "same-point-via",
    props: {
      nodeWithPortPoints: node([
        { connectionName: "a", x: 0, y: 0, z: 0 },
        { connectionName: "a", x: 0, y: 0, z: 1 },
      ]),
    },
  },
  {
    name: "connected-nets",
    props: {
      nodeWithPortPoints: crossing,
      connMap: new ConnectivityMap({ root: ["a", "b"] }),
    },
  },
  {
    name: "shuffle",
    props: { nodeWithPortPoints: crossing, hyperParameters: { SHUFFLE_SEED: 3 } },
  },
  {
    name: "iteration-cap",
    props: { nodeWithPortPoints: crossing },
    maxIterations: 2,
  },
]

const snapshot = (solver: IntraNodeRouteSolver): unknown => {
  const child = solver.activeSubSolver
  return JSON.parse(JSON.stringify({
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    iterations: solver.iterations,
    maxIterations: solver.MAX_ITERATIONS,
    progress: solver.progress,
    solvedRoutes: solver.solvedRoutes,
    solvedRoutesJson: JSON.stringify(solver.solvedRoutes),
    unsolvedConnections: solver.unsolvedConnections,
    failedSubSolvers: solver.failedSubSolvers.length,
    active: child ? {
      solved: child.solved,
      failed: child.failed,
      error: child.error,
      iterations: child.iterations,
      maxIterations: child.MAX_ITERATIONS,
      progress: child.progress,
      solvedPath: child.solvedPath ?? null,
      solvedPathJson: JSON.stringify(child.solvedPath ?? null),
    } : null,
  }))
}

const outputDirectory = resolve(process.argv[2] ?? "/tmp/general-router-parity")
mkdirSync(outputDirectory, { recursive: true })
writeFileSync(`${outputDirectory}/fixtures.json`, JSON.stringify(fixtures))
const expected: Run[] = fixtures.map((fixture): Run => {
  const solver = new IntraNodeRouteSolver(fixture.props)
  if (fixture.maxIterations !== undefined) solver.MAX_ITERATIONS = fixture.maxIterations
  const trace: unknown[] = [snapshot(solver)]
  while (!solver.solved && !solver.failed) {
    if (solver.iterations >= 100_000) throw new Error(`${fixture.name} exceeded safety budget`)
    solver.step()
    trace.push(snapshot(solver))
  }
  return { name: fixture.name, trace }
})
writeFileSync(`${outputDirectory}/typescript.json`, JSON.stringify(expected))
const executable = resolve(import.meta.dir, "../target/debug/examples/parity")
const rust = Bun.spawnSync([executable], {
  stdin: Buffer.from(JSON.stringify(fixtures)),
  stdout: "pipe",
  stderr: "pipe",
})
if (rust.exitCode !== 0) throw new Error(`Rust parity process failed: ${rust.stderr.toString()}`)
writeFileSync(`${outputDirectory}/rust.json`, rust.stdout.toString())
const actual = JSON.parse(rust.stdout.toString()) as Run[]
for (let i = 0; i < expected.length; i++) {
  const tsRun = expected[i]!
  const rustRun = actual[i]!
  deepStrictEqual(rustRun.name, tsRun.name)
  for (let step = 0; step < Math.max(tsRun.trace.length, rustRun.trace.length); step++) {
    deepStrictEqual(rustRun.trace[step], tsRun.trace[step], `${tsRun.name}: mismatch at step ${step}`)
  }
  console.log(`${tsRun.name}: ${tsRun.trace.length - 1} steps identical`)
}
deepStrictEqual(actual.length, expected.length)
console.log(`Exact per-step parity passed; artifacts: ${outputDirectory}`)
