import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
type HighDensitySolverA01Props = ConstructorParameters<
  typeof HighDensitySolverA01
>[0]

type RippedNode = { id: number; prev: RippedNode | null }
type ObjectNode = {
  z: number
  row: number
  col: number
  g: number
  parentIdx: number
  ripped: RippedNode | null
}
type NumericNodeState = {
  nodeCount: number
  nodeZ: Float64Array
  nodeRow: Float64Array
  nodeCol: Float64Array
  nodeG: Float64Array
  nodeParent: Float64Array
  nodeRipped: Array<RippedNode | null>
  ripCount: number[]
  totalRipEvents: number
  baseSearchBudgetIters: number
  appendSearchNode(
    z: number,
    row: number,
    col: number,
    g: number,
    parent: number,
    ripped: RippedNode | null,
  ): number
  resetSearchNodes(): void
}

// Independent original object representation. Numeric reads use facades so the
// unchanged expansion/finalization logic consumes the original JS values.
function useObjectNodeReference(solver: HighDensitySolverA01): void {
  const state = solver as unknown as NumericNodeState
  let nodes: ObjectNode[] = []
  const fields = {
    nodeZ: "z",
    nodeRow: "row",
    nodeCol: "col",
    nodeG: "g",
    nodeParent: "parentIdx",
    nodeRipped: "ripped",
  } as const
  for (const [target, source] of Object.entries(fields)) {
    Object.defineProperty(solver, target, {
      value: new Proxy(
        {},
        {
          get(_target, key): unknown {
            if (key === "length") return nodes.length
            return typeof key === "string"
              ? nodes[Number(key)]?.[source as keyof ObjectNode]
              : undefined
          },
        },
      ),
      writable: true,
      configurable: true,
    })
  }
  state.appendSearchNode = (z, row, col, g, parentIdx, ripped): number => {
    const index = nodes.length
    nodes.push({ z, row, col, g, parentIdx, ripped })
    state.nodeCount = nodes.length
    return index
  }
  state.resetSearchNodes = (): void => {
    nodes = []
    state.nodeCount = 0
  }
}

function createProps(
  seed: number,
  layers: number[],
): HighDensitySolverA01Props {
  return {
    nodeWithPortPoints: {
      capacityMeshNodeId: "numeric-node-parity",
      center: { x: 0, y: 0 },
      width: 3,
      height: 3,
      availableZ: layers,
      portPoints: Array.from({ length: 4 }, (_, index) => [
        {
          connectionName: `trace${index}`,
          rootConnectionName: index < 2 ? "shared" : `net${index}`,
          x: -1.5,
          y: -0.9 + index * 0.6,
          z: layers[index % layers.length]!,
        },
        {
          connectionName: `trace${index}`,
          rootConnectionName: index < 2 ? "shared" : `net${index}`,
          x: 1.5,
          y: 0.9 - index * 0.6,
          z: layers[(index + 1) % layers.length]!,
        },
      ]).flat(),
    },
    cellSizeMm: 0.1,
    traceThickness: 0.1,
    traceMargin: 0.1,
    viaDiameter: 0.3,
    hyperParameters: { shuffleSeed: seed },
  }
}

test("numeric A01 nodes preserve object search results and release bounded reusable storage", (): void => {
  let observedRip = false
  for (const [seed, layers, limited] of [
    [1, [0, 1], false],
    [3, [0, 1, 2, 3], false],
    [1, [0, 1], true],
  ] as const) {
    const props = createProps(seed, [...layers])
    const numeric = new HighDensitySolverA01(props)
    const reference = new HighDensitySolverA01(props)
    useObjectNodeReference(reference)
    if (limited) {
      numeric.setup()
      reference.setup()
      ;(numeric as unknown as NumericNodeState).baseSearchBudgetIters = 1
      ;(reference as unknown as NumericNodeState).baseSearchBudgetIters = 1
    }
    numeric.solve()
    reference.solve()
    const actual = numeric as unknown as NumericNodeState
    const expected = reference as unknown as NumericNodeState
    expect(numeric.solved).toBe(reference.solved)
    expect(numeric.failed).toBe(reference.failed)
    expect(numeric.error).toBe(reference.error)
    expect(numeric.iterations).toBe(reference.iterations)
    expect(numeric.getOutput()).toEqual(reference.getOutput())
    expect(actual.ripCount).toEqual(expected.ripCount)
    expect(actual.totalRipEvents).toBe(expected.totalRipEvents)
    expect(actual.nodeCount).toBe(0)
    expect(actual.nodeRipped.every((node) => node === null)).toBeTrue()
    observedRip ||= actual.ripCount.some((count) => count > 0)
    if (limited) expect(numeric.failed).toBeTrue()
    else expect(numeric.solved).toBeTrue()
  }
  expect(observedRip).toBeTrue()

  const numeric = new HighDensitySolverA01(createProps(1, [0, 1]))
  const state = numeric as unknown as NumericNodeState
  const ripped: RippedNode = { id: 3, prev: { id: 7, prev: null } }
  const values = [
    0,
    -0,
    NaN,
    Infinity,
    -Infinity,
    Number.MIN_VALUE,
    Math.SQRT2,
    1e300,
  ]
  for (let index = 0; index < 513; index++) {
    const value = values[index % values.length]!
    expect(
      state.appendSearchNode(value, value, value, value, index - 1, ripped),
    ).toBe(index)
  }
  for (let index = 0; index < 513; index++) {
    const value = values[index % values.length]!
    expect(Object.is(state.nodeZ[index], value)).toBeTrue()
    expect(Object.is(state.nodeRow[index], value)).toBeTrue()
    expect(Object.is(state.nodeCol[index], value)).toBeTrue()
    expect(Object.is(state.nodeG[index], value)).toBeTrue()
    expect(state.nodeParent[index]).toBe(index - 1)
    expect(state.nodeRipped[index]).toBe(ripped)
  }
  const retainedBuffer = state.nodeG.buffer
  const retainedRips = state.nodeRipped
  state.resetSearchNodes()
  expect(state.nodeCount).toBe(0)
  expect(state.nodeG.buffer).toBe(retainedBuffer)
  expect(retainedRips.slice(0, 513).every((node) => node === null)).toBeTrue()
  for (const value of values) {
    const index = state.appendSearchNode(
      value,
      value,
      value,
      value,
      value,
      null,
    )
    expect(Object.is(state.nodeParent[index], value)).toBeTrue()
  }
  state.resetSearchNodes()
  expect(state.appendSearchNode(-0, NaN, Infinity, -0, -1, null)).toBe(0)
  expect(Object.is(state.nodeG[0], -0)).toBeTrue()
  expect(state.nodeParent[0]).toBe(-1)
  for (let index = 1; index < 65_537; index++)
    state.appendSearchNode(0, index, 1, index / 7, index - 1, ripped)
  expect(state.nodeG.length).toBeGreaterThan(65_536)
  expect(state.nodeParent[65_536]).toBe(65_535)
  expect(state.nodeG[65_536]).toBe(65_536 / 7)
  state.resetSearchNodes()
  expect(state.nodeCount).toBe(0)
  expect(state.nodeG.length).toBe(0)
  expect(state.nodeZ.length).toBe(0)
  expect(state.nodeRow.length).toBe(0)
  expect(state.nodeCol.length).toBe(0)
  expect(state.nodeParent.length).toBe(0)
  expect(state.nodeRipped).toHaveLength(0)
})
