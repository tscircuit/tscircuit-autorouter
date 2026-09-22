import type { EvaluateRelaxedDrcInput } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"

/** Label the repaired routing explicitly: the complete pipeline still fails. */
export const getAm3352FailureSnapshotSvg = (
  input: EvaluateRelaxedDrcInput,
): string => {
  const boardSvg = getBugReportSnapshotSvg(input).replace(
    "<svg ",
    '<svg y="80" ',
  )
  return `<svg width="640" height="720" viewBox="0 0 640 720" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><text x="12" y="28" font-family="Arial, sans-serif" font-size="22" font-weight="600" fill="#b91c1c">Length matching failed — board is not clean</text><text x="12" y="54" font-family="Arial, sans-serif" font-size="14" fill="#111827">DDR_BYTE0 / source_net_70 needs 5.1637 mm additional length</text>${boardSvg}</svg>`
}
