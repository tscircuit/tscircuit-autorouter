import { expect, test } from "bun:test"
import { HighDensityRepairSolver } from "high-density-repair02"
import repairInput from "../../fixtures/bug-reports/dataset01-circuit103-cmn_3/cmn_3-high-density-repair-input.json" with {
  type: "json",
}

test("high-density-repair02 dataset01 circuit103 cmn_3 snapshot", async () => {
  const solver = new HighDensityRepairSolver({
    sample: repairInput.sample,
    margin: repairInput.margin,
  })

  solver.solve()

  const output = solver.getOutput()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(output.repairedRoutes).toHaveLength(
    repairInput.sample.nodeHdRoutes.length,
  )
  expect(repairInput.sample.nodeWithPortPoints.capacityMeshNodeId).toBe("cmn_3")
  expect(repairInput.sample.nodeWithPortPoints.portPoints).toHaveLength(30)
  expect(repairInput.sample.nodeHdRoutes).toHaveLength(15)

  await expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path, {
    backgroundColor: "white",
  })
})
