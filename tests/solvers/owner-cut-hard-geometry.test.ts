import { expect, test } from "bun:test"
import { OwnerCutHighDensitySolver } from "lib/solvers/HighDensitySolver/OwnerCutHighDensitySolver"
import { ownerCutParams } from "./ownerCutTestUtils"

type KernelProbe = {
  cols: number; rows: number
  activeConnId: number
  activeConnSeg: null
  portOwnerFlat: Int32Array
  usedDiagFlat: Int32Array
  _moveCost: number
  computeMoveCostAndRips: (owner: number, z: number, row: number, col: number,
    nz: number, nr: number, nc: number,
    ripped: { id: number; prev: null } | null) => void
}

test("owner permissions preserve fixed ports and native immutable diagonal crossings", (): void => {
  const solver = new OwnerCutHighDensitySolver(ownerCutParams())
  solver.setup()
  const kernel = solver as unknown as KernelProbe
  kernel.activeConnSeg = null
  kernel.activeConnId = 0
  kernel.portOwnerFlat[kernel.cols + 1] = 1
  kernel.computeMoveCostAndRips(0, 0, 1, 0, 0, 1, 1, { id: 1, prev: null })
  expect(kernel._moveCost).toBe(-1)
  kernel.portOwnerFlat[kernel.cols + 1] = -1
  kernel.usedDiagFlat[1] = 1
  kernel.computeMoveCostAndRips(0, 0, 0, 0, 0, 1, 1, { id: 1, prev: null })
  expect(kernel._moveCost).toBe(-1)
})
