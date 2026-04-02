import { expect, test } from "bun:test"
import { extractCapacityMeshNodeIdFromObjectLabel } from "lib/testing/utils/extractCapacityMeshNodeIdFromObjectLabel"

test("extractCapacityMeshNodeIdFromObjectLabel parses plain node labels", () => {
  expect(extractCapacityMeshNodeIdFromObjectLabel("cmn_0 (CENTER)")).toBe(
    "cmn_0",
  )
  expect(extractCapacityMeshNodeIdFromObjectLabel("new-cmn_0-0")).toBe(
    "new-cmn_0-0",
  )
})

test("extractCapacityMeshNodeIdFromObjectLabel parses multiline high-density labels", () => {
  expect(
    extractCapacityMeshNodeIdFromObjectLabel(
      "hd_node_marker\nnode: new-cmn_0-0\nstatus: solved",
    ),
  ).toBe("new-cmn_0-0")
})

test("extractCapacityMeshNodeIdFromObjectLabel preserves subdivided node ids", () => {
  expect(
    extractCapacityMeshNodeIdFromObjectLabel("cn_12__sub_1_3 (hovered)"),
  ).toBe("cn_12__sub_1_3")
})
