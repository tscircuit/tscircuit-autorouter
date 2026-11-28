import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { convertSrjTracesToObstacles } from "lib/utils/convertSrjTracesToObstacles"

export function preprocessAssignableSimpleRouteJson(
  srj: SimpleRouteJson,
): SimpleRouteJson {
  if (!srj.traces?.length) return srj
  const srjWithTraceObstacles = convertSrjTracesToObstacles(srj) ?? srj
  if (srjWithTraceObstacles === srj) return srj
  return addApproximatingRectsToSrj(srjWithTraceObstacles)
}
