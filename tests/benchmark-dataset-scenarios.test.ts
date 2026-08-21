import { expect, test } from "bun:test";
import {
  loadScenarioBySampleNumber,
  loadScenarios,
} from "../scripts/benchmark/scenarios";

test("benchmark datasets load in sample order", async () => {
  const srj11Scenarios = await loadScenarios("srj11");
  const srj12Scenarios = await loadScenarios("srj12");
  const srj13Scenarios = await loadScenarios("srj13");
  const srj15Scenarios = await loadScenarios("srj15");
  const srj16Scenarios = await loadScenarios("srj16");
  const srj19Scenarios = await loadScenarios("srj19");
  const srj20Scenarios = await loadScenarios("srj20");
  const srj23Scenarios = await loadScenarios("srj23");
  const srj24Scenarios = await loadScenarios("srj24");
  const srj27Scenarios = await loadScenarios("srj27");
  const srj28Scenarios = await loadScenarios("srj28");
  const srj29Scenarios = await loadScenarios("srj29");

  expect(srj11Scenarios).toHaveLength(26);
  expect(srj11Scenarios[0][0]).toBe("sample001Circuit");
  expect(srj11Scenarios[25][0]).toBe("sample026Circuit");
  expect(srj11Scenarios[0][1].bounds).toBeDefined();

  expect(srj12Scenarios).toHaveLength(10);
  expect(srj12Scenarios[0][0]).toBe("sample001Circuit");
  expect(srj12Scenarios[9][0]).toBe("sample010Circuit");
  expect(srj12Scenarios[0][1].bounds).toBeDefined();

  expect(srj13Scenarios).toHaveLength(50);
  expect(srj13Scenarios[0][0]).toBe("example_01");
  expect(srj13Scenarios[49][0]).toBe("example_50");
  expect(srj13Scenarios[0][1].bounds).toBeDefined();

  expect(srj15Scenarios).toHaveLength(55);
  expect(srj15Scenarios[0][0]).toBe("sample001Circuit");
  expect(srj15Scenarios[24][0]).toBe("sample025Circuit");
  expect(srj15Scenarios[0][1].connections.length).toBeGreaterThan(0);

  expect(srj16Scenarios).toHaveLength(200);
  expect(srj16Scenarios[0][0]).toBe("sample001Circuit");
  expect(srj16Scenarios[199][0]).toBe("sample200Circuit");
  expect(srj16Scenarios[0][1].connections.length).toBeGreaterThan(0);

  expect(srj19Scenarios).toHaveLength(200);
  expect(srj19Scenarios[0][0]).toBe("sample001Circuit");
  expect(srj19Scenarios[199][0]).toBe("sample200Circuit");
  expect(srj19Scenarios[0][1].connections.length).toBeGreaterThan(0);

  expect(srj20Scenarios).toHaveLength(200);
  expect(srj20Scenarios[0][0]).toBe("sample001Circuit");
  expect(srj20Scenarios[199][0]).toBe("sample200Circuit");
  expect(srj20Scenarios[0][1].connections.length).toBeGreaterThan(0);

  expect(srj23Scenarios).toHaveLength(76);
  expect(srj23Scenarios[0][0]).toBe("circuit001");
  expect(srj23Scenarios[75][0]).toBe("circuit106");
  expect(srj23Scenarios[0][1].connections.length).toBeGreaterThan(0);

  expect(srj24Scenarios).toHaveLength(10);
  expect(srj24Scenarios[0][0]).toBe("sample001");
  expect(srj24Scenarios[9][0]).toBe("sample010");
  expect(srj24Scenarios[0][1].connections.length).toBeGreaterThan(0);

  expect(srj27Scenarios).toHaveLength(6);
  expect(srj27Scenarios[0][0]).toBe("sample001");
  expect(srj27Scenarios[5][0]).toBe("sample006");
  expect(srj27Scenarios[0][1].connections.length).toBeGreaterThan(0);

  expect(srj28Scenarios).toHaveLength(85);
  expect(srj28Scenarios[0][0]).toBe("circuit001");
  expect(srj28Scenarios[84][0]).toBe("circuit181");
  expect(srj28Scenarios[0][1].traces?.length).toBeGreaterThan(0);

  expect(srj29Scenarios).toHaveLength(21);
  expect(srj29Scenarios[0][0]).toBe("sample001");
  expect(srj29Scenarios[20][0]).toBe("sample021");
  expect(srj29Scenarios[0][1].connections.length).toBeGreaterThan(0);
  expect(srj29Scenarios[20][1].layerCount).toBe(8);
  expect(srj29Scenarios[20][1].connections).toHaveLength(33);
  expect(srj29Scenarios[20][1].obstacles).toHaveLength(573);

  const sample11 = await loadScenarioBySampleNumber("srj11", 11);
  expect(sample11.scenarioName).toBe("sample011Circuit");
  expect(sample11.totalSamples).toBe(26);

  const sample13 = await loadScenarioBySampleNumber("srj13", 13);
  expect(sample13.scenarioName).toBe("example_13");
  expect(sample13.totalSamples).toBe(50);

  const sample16 = await loadScenarioBySampleNumber("srj16", 16);
  expect(sample16.scenarioName).toBe("sample016Circuit");
  expect(sample16.totalSamples).toBe(200);

  const sample19 = await loadScenarioBySampleNumber("srj19", 19);
  expect(sample19.scenarioName).toBe("sample019Circuit");
  expect(sample19.totalSamples).toBe(200);

  const sample20 = await loadScenarioBySampleNumber("srj20", 20);
  expect(sample20.scenarioName).toBe("sample020Circuit");
  expect(sample20.totalSamples).toBe(200);

  const sample23 = await loadScenarioBySampleNumber("srj23", 23);
  expect(sample23.scenarioName).toBe("circuit029");
  expect(sample23.totalSamples).toBe(76);

  const sample24 = await loadScenarioBySampleNumber("srj24", 10);
  expect(sample24.scenarioName).toBe("sample010");
  expect(sample24.totalSamples).toBe(10);

  const sample27 = await loadScenarioBySampleNumber("srj27", 6);
  expect(sample27.scenarioName).toBe("sample006");
  expect(sample27.totalSamples).toBe(6);

  const sample28 = await loadScenarioBySampleNumber("srj28", 85);
  expect(sample28.scenarioName).toBe("circuit181");
  expect(sample28.totalSamples).toBe(85);

  const sample29 = await loadScenarioBySampleNumber("srj29", 21);
  expect(sample29.scenarioName).toBe("sample021");
  expect(sample29.totalSamples).toBe(21);
});
