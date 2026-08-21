import { expect, test } from "bun:test";
import { renderProfileComparison } from "../scripts/profile/profile-comparison";

test("profile comparison renders paired percentiles and hides small stages", () => {
  const createReport = (route: number, repair: number, small: number) => ({
    datasetName: "srj18",
    scenarioCount: 3,
    solved: 3,
    failed: 0,
    completedScenarios: [1, 2, 3].map((index) => ({
      scenarioName: `sample00${index}`,
      elapsedTimeMs: 100,
      stageTimings: [
        { solverName: "routeSolver", timeMs: route },
        { solverName: "repairSolver", timeMs: repair },
        { solverName: "smallSolver", timeMs: small },
      ],
    })),
  });

  const output = renderProfileComparison({
    mainReport: createReport(79, 20, 1),
    prReport: createReport(69, 30, 1),
    mainSha: "1234567890",
    prSha: "abcdef1234",
    repository: "tscircuit/tscircuit-autorouter",
    runnerName: "blacksmith-test-runner",
  });

  expect(output).toContain(
    "| routeSolver | 79.0% | 69.0% | 79.0% | 69.0% | 79.0% | 69.0% |",
  );
  expect(output).toContain(
    "| repairSolver | 20.0% | 30.0% | 20.0% | 30.0% | 20.0% | 30.0% |",
  );
  expect(output).not.toContain("| smallSolver |");
});
