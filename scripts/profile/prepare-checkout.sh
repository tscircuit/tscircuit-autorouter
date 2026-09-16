#!/usr/bin/env bash
set -euo pipefail

# Install measurement hooks in a disposable comparison checkout. The patch only
# measures existing steps; it does not copy routing code from the controller.
CONTROLLER_DIR="$1"
CHECKOUT_DIR="$2"
PATCH_PATH="$(cd "$CONTROLLER_DIR" && pwd)/scripts/profile/solver-instrumentation.patch"

if git -C "$CHECKOUT_DIR" apply --check "$PATCH_PATH" 2>/dev/null; then
  git -C "$CHECKOUT_DIR" apply "$PATCH_PATH"
else
  # Already instrumented revisions must contain the exact same hooks. Refuse
  # incompatible sources rather than silently producing an incomplete profile.
  git -C "$CHECKOUT_DIR" apply --reverse --check "$PATCH_PATH"
fi

cp "$CONTROLLER_DIR/lib/solvers/SolverProfiler.ts" "$CHECKOUT_DIR/lib/solvers/SolverProfiler.ts"
cp "$CONTROLLER_DIR/scripts/profile-solvers.ts" "$CHECKOUT_DIR/scripts/profile-solvers.ts"
cp "$CONTROLLER_DIR/scripts/benchmark/scenarios.ts" "$CHECKOUT_DIR/scripts/benchmark/scenarios.ts"
