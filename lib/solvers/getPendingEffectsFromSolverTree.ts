import type { PendingEffect } from "./BaseSolver"

type PendingEffectsSolver = {
  activeSubSolver?: PendingEffectsSolver | null
  pendingEffects?: PendingEffect[]
}

export const getPendingEffectsFromSolverTree = (
  rootSolver: PendingEffectsSolver | null | undefined,
): PendingEffect[] => {
  const solverChain: PendingEffectsSolver[] = []
  let currentSolver = rootSolver

  while (currentSolver) {
    solverChain.push(currentSolver)
    currentSolver = currentSolver.activeSubSolver
  }

  for (let i = solverChain.length - 1; i >= 0; i--) {
    const pendingEffects = solverChain[i]?.pendingEffects?.filter(Boolean) ?? []
    if (pendingEffects.length > 0) {
      return pendingEffects
    }
  }

  return []
}
