import { expect, test } from "bun:test"
import { createSharedSolverBuffer } from "../../lib/execution/createSharedSolverBuffer"

test("shared snapshots preserve visible bytes, offsets, and source isolation", (): void => {
  const source = new Float64Array([99, Math.PI, -0, 42])
  const view = source.subarray(1, 3)
  const expected = new Uint8Array(
    source.buffer,
    view.byteOffset,
    view.byteLength,
  ).slice()
  const shared = createSharedSolverBuffer(view)
  expect(shared).toBeInstanceOf(SharedArrayBuffer)
  expect(shared.byteLength).toBe(view.byteLength)
  expect(new Uint8Array(shared)).toEqual(expected)
  expect(Object.is(new Float64Array(shared)[1], -0)).toBe(true)
  source[1] = 0
  expect(new Float64Array(shared)[0]).toBe(Math.PI)

  const bytes = new Uint8Array([1, 2, 3, 4])
  const dataView = new DataView(bytes.buffer, 1, 2)
  expect(new Uint8Array(createSharedSolverBuffer(dataView))).toEqual(
    new Uint8Array([2, 3]),
  )
  expect(createSharedSolverBuffer(new Uint8Array(0)).byteLength).toBe(0)
})
