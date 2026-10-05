import { CapacityMeshNode } from "lib/types"

// 1206x4
const JUMPER_SIZE_WIDTH_WITH_PADDING = 1.6
const JUMPER_SIZE_HEIGHT_WITH_PADDING = 3.2
const JUMPER_SIZE_AREA =
  JUMPER_SIZE_WIDTH_WITH_PADDING * JUMPER_SIZE_HEIGHT_WITH_PADDING

const CROSSINGS_PER_JUMPER_BEFORE_90_PERCENT_FAILURE = 2

export const calculateNodeProbabilityOfFailureWithJumpers = (
  node: CapacityMeshNode,
  numSameLayerCrossings: number,
) => {
  const jumpersRequired = Math.ceil(
    numSameLayerCrossings / CROSSINGS_PER_JUMPER_BEFORE_90_PERCENT_FAILURE,
  )

  const nodeDimMin = Math.min(node.width, node.height)
  const nodeDimMax = Math.max(node.width, node.height)

  const jumpersWeCanFitInNodeWide =
    Math.floor(nodeDimMin / JUMPER_SIZE_WIDTH_WITH_PADDING) + 0.1
  const jumpersWeCanFitInNodeTall =
    Math.floor(nodeDimMax / JUMPER_SIZE_HEIGHT_WITH_PADDING) + 0.1

  const jumpersWeCanFitInNode =
    (jumpersWeCanFitInNodeWide * jumpersWeCanFitInNodeTall) / JUMPER_SIZE_AREA

  return Math.min(1, jumpersRequired / jumpersWeCanFitInNode)
}
