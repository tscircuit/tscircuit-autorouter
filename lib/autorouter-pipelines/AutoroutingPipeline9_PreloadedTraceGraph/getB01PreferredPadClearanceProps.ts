import type { HighDensitySolverB01 } from "@tscircuit/high-density-b01"

type B01Props = ConstructorParameters<typeof HighDensitySolverB01>[0]

export function getB01PreferredPadClearanceProps(
  props: B01Props,
): B01Props | undefined {
  const preferredClearance = props.obstacleClearanceMargin ?? 0
  let hasPreferredPadClearance = false
  const obstacles = props.obstacles.map((obstacle) => {
    if (obstacle.type !== "rect") return obstacle
    let { traceClearanceMargin, viaClearanceMargin } = obstacle
    if (
      traceClearanceMargin !== undefined &&
      traceClearanceMargin < preferredClearance
    ) {
      traceClearanceMargin = undefined
      hasPreferredPadClearance = true
    }
    if (
      viaClearanceMargin !== undefined &&
      viaClearanceMargin < preferredClearance
    ) {
      viaClearanceMargin = undefined
      hasPreferredPadClearance = true
    }
    return { ...obstacle, traceClearanceMargin, viaClearanceMargin }
  })
  if (hasPreferredPadClearance) return { ...props, obstacles }
}
