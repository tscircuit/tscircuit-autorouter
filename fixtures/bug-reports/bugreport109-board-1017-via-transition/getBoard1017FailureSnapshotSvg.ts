import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"

/** Preserve the solver's native visualization at the confirmed crash. */
export const getBoard1017FailureSnapshotSvg = (
  graphics: GraphicsObject,
): string => {
  const boardSvg = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
  }).replace("<svg ", '<svg y="132" ')
  return `<svg width="640" height="772" viewBox="0 0 640 772" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/><rect width="640" height="124" fill="#fef2f2"/><text x="12" y="28" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#b91c1c">Routing failed during trace simplification</text><text x="12" y="54" font-family="Arial, sans-serif" font-size="15" fill="#b91c1c">SameNetViaMergerSolver: missing route transition</text><text x="12" y="78" font-family="Arial, sans-serif" font-size="14" fill="#111827">Via (-5.8, -22.1) on source_net_0_mst44</text><text x="12" y="104" font-family="Arial, sans-serif" font-size="13" fill="#111827">Solver visualization at the crash — solved: false, failed: true</text>${boardSvg}</svg>`
}
