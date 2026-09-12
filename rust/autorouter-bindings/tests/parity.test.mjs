import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import { build } from "esbuild"
import { loadAutorouterBindings, HighDensitySolverAdapter } from "../dist/index.js"

const crossingPoints = [
  { connectionName: "horizontal_mst0", rootConnectionName: "horizontal", portPointId: "west", x: -1.91, y: 0.07, z: 0, source: { pin: "1" } },
  { connectionName: "horizontal_mst0", rootConnectionName: "horizontal", portPointId: "east", x: 1.93, y: 0.07, z: 0, source: { pin: "2" } },
  { connectionName: "vertical_mst1", portPointId: "south", x: 0.03, y: -1.89, z: 0 },
  { connectionName: "vertical_mst1", portPointId: "north", x: 0.03, y: 1.87, z: 0 },
]

const fixtures = [
  { name: "crossing", points: crossingPoints },
  {
    name: "layer-transition",
    points: [
      { connectionName: "via_mst12", portPointId: "start", x: -1.83, y: -1.29, z: 0, insideJumperPad: false, custom: [1, "endpoint"] },
      { connectionName: "via_mst12", portPointId: "end", x: 1.81, y: 1.31, z: 1, custom: { untouched: true } },
    ],
  },
  {
    name: "linked-segments",
    points: [
      { connectionName: "chain_mst1", rootConnectionName: "root", portPointId: "c", prevPortPointId: "b", x: 1.8, y: 0.7, z: 0 },
      { connectionName: "chain_mst1", rootConnectionName: "root", portPointId: "a", nextPortPointId: "b", x: -1.8, y: -0.7, z: 0 },
      { connectionName: "chain_mst1", rootConnectionName: "root", portPointId: "b", prevPortPointId: "a", nextPortPointId: "c", x: 0, y: -0.7, z: 0 },
      { connectionName: "chain_mst1", rootConnectionName: "root", portPointId: "unlinked-a", x: -1.8, y: 1.5, z: 1 },
      { connectionName: "chain_mst1", rootConnectionName: "root", portPointId: "unlinked-b", x: 1.8, y: 1.5, z: 1 },
    ],
  },
  {
    name: "shuffle-and-batched-steps",
    points: crossingPoints,
    options: { stepMultiplier: 7, hyperParameters: { shuffleSeed: 193, greedyMultiplier: 1.2, ripCost: 12, viaBaseCost: 3 } },
  },
  {
    name: "initial-penalties",
    points: crossingPoints,
    options: { stepMultiplier: 3 },
    penalty: true,
  },
  {
    name: "translated-bounds",
    points: crossingPoints.map((point) => ({ ...point, x: point.x + 73.123, y: point.y - 19.234 })),
    node: { center: { x: 73.123, y: -19.234 }, width: 4.11, height: 4.07 },
  },
  {
    name: "explicit-undefined-metadata",
    points: [
      { connectionName: "metadata_mst1", rootConnectionName: undefined, portPointId: "metadata-start", prevPortPointId: undefined, x: -1.7, y: -1.3, z: 0, insideJumperPad: undefined, custom: undefined, nested: { missing: undefined, present: null } },
      { connectionName: "metadata_mst1", portPointId: "metadata-end", nextPortPointId: undefined, x: 1.7, y: 1.3, z: 0, custom: [undefined, null] },
    ],
  },
  {
    name: "cell-count-limit",
    points: crossingPoints,
    options: { maxCellCount: 1 },
    expectedFailed: true,
    setupFailure: true,
  },
  {
    name: "iteration-limit",
    points: crossingPoints,
    maxIterations: 1,
    expectedFailed: true,
  },
]

function compareState(actual, expected, context, includeSegments) {
  for (const key of ["solved", "failed", "iterations", "MAX_ITERATIONS", "error"]) {
    assert.equal(actual[key], expected[key], `${context}: ${key}`)
  }
  if (includeSegments) {
    let expectedSegments = 0
    for (const segments of expected.solvedConnectionsMap.values()) {
      expectedSegments += segments.length
    }
    assert.equal(actual.getSolvedSegmentCount(), expectedSegments, `${context}: solved segment count`)
  }
}

function makeProps(fixture, calls) {
  const props = {
    nodeWithPortPoints: {
      capacityMeshNodeId: fixture.name,
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints: structuredClone(fixture.points),
      originalNodeMetadata: { untouched: true },
      ...fixture.node,
    },
    cellSizeMm: 0.2,
    highResolutionCellSize: 0.2,
    highResolutionCellThickness: 0.6,
    lowResolutionCellSize: 0.4,
    viaDiameter: 0.3,
    traceThickness: 0.1,
    traceMargin: 0.05,
    ...fixture.options,
  }
  if (fixture.penalty) {
    props.initialPenaltyFn = (point) => {
      calls.push(point)
      return Math.abs(point.x) < 0.45 && point.y > -0.5 ? 2.125 : 0.125
    }
  }
  return props
}

test("A01 and A03 match TypeScript at every step and serialize identical routes", async () => {
  const referenceBuild = await build({
    stdin: {
      contents: 'export { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"',
      resolveDir: fileURLToPath(new URL("../../../", import.meta.url)),
      sourcefile: "high-density-reference.ts",
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  })
  const referenceDir = await mkdtemp(join(tmpdir(), "high-density-reference-"))
  const referencePath = join(referenceDir, "reference.mjs")
  let reference
  try {
    await writeFile(referencePath, referenceBuild.outputFiles[0].text)
    reference = await import(pathToFileURL(referencePath).href)
  } finally {
    await rm(referenceDir, { recursive: true, force: true })
  }
  await loadAutorouterBindings({ module_or_path: await readFile(new URL("../pkg/autorouter_bindings_bg.wasm", import.meta.url)) })

  const realNode = JSON.parse(await readFile(new URL("./fixtures/a03-cmn20.json", import.meta.url), "utf8"))
  fixtures.push({ name: "real-node-cmn20", points: realNode.nodeWithPortPoints.portPoints, node: realNode.nodeWithPortPoints, options: realNode, variant: "a03", expectedFailed: true })

  for (const [variant, ReferenceSolver] of [["a01", reference.HighDensitySolverA01], ["a03", reference.HighDensitySolverA03]]) {
    for (const fixture of fixtures) {
      if (fixture.variant && fixture.variant !== variant) continue
      const context = `${variant}/${fixture.name}`
      const expectedPenaltyCalls = []
      const actualPenaltyCalls = []
      const expected = new ReferenceSolver(makeProps(fixture, expectedPenaltyCalls))
      const actual = new HighDensitySolverAdapter(variant, makeProps(fixture, actualPenaltyCalls))
      try {
        if (fixture.maxIterations !== undefined) {
          expected.MAX_ITERATIONS = fixture.maxIterations
          actual.MAX_ITERATIONS = fixture.maxIterations
        }
        compareState(actual, expected, `${context} constructor`, false)
        expected.setup()
        actual.setup()
        compareState(actual, expected, `${context} setup`, !fixture.setupFailure)
        assert.deepEqual(actualPenaltyCalls, expectedPenaltyCalls, `${context}: initialPenaltyFn inputs and order`)

        if (fixture.setupFailure) {
          assert.equal(expected.failed, true, `${context}: setup must fail`)
          assert.match(expected.error, /Cell count .* exceeds maxCellCount 1/, `${context}: setup failure reason`)
          expected.step()
          actual.step()
          compareState(actual, expected, `${context} failed setup step`, false)
          continue
        }

        let steps = 0
        while (!expected.solved && !expected.failed) {
          expected.step()
          actual.step()
          steps++
          compareState(actual, expected, `${context} step ${steps}`, true)
          assert.ok(steps <= expected.MAX_ITERATIONS + 1, `${context}: fixture exceeded its bounded search budget`)
        }
        assert.equal(expected.failed, fixture.expectedFailed ?? false, `${context}: fixture expected outcome`)
        const expectedOutput = expected.getOutput()
        const actualOutput = actual.getOutput()
        assert.deepEqual(actualOutput, expectedOutput, `${context}: final route output`)
        assert.equal(JSON.stringify(actualOutput), JSON.stringify(expectedOutput), `${context}: serialized route bytes`)

        expected.step()
        actual.step()
        compareState(actual, expected, `${context} terminal step`, true)
      } finally {
        actual.dispose()
      }
    }
  }
})
