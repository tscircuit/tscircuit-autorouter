import { CapacityMeshNode } from "lib/types"

// 1206x4
const JUMPER_SIZE_WIDTH_WITH_PADDING = 5
const JUMPER_SIZE_HEIGHT_WITH_PADDING = 5.5

const CROSSINGS_PER_JUMPER_BEFORE_50_PERCENT_FAILURE = 7

export const calculateNodeProbabilityOfFailureWithJumpers = (
  node: CapacityMeshNode,
  numSameLayerCrossings: number,
) => {
  const jumpersRequired = Math.ceil(
    numSameLayerCrossings / CROSSINGS_PER_JUMPER_BEFORE_50_PERCENT_FAILURE,
  )

  const jumpersWeCanFitInNodeWide =
    Math.floor(node.width / JUMPER_SIZE_WIDTH_WITH_PADDING) + 0.1
  const jumpersWeCanFitInNodeTall =
    Math.floor(node.height / JUMPER_SIZE_HEIGHT_WITH_PADDING) + 0.1

  const jumpersWeCanFitInNode =
    jumpersWeCanFitInNodeWide * jumpersWeCanFitInNodeTall

  return Math.min(1, jumpersRequired / jumpersWeCanFitInNode)
}
