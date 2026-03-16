// TraceThicknessTests.ts

import { TraceThickness } from './trace-thickness';
import { TraceThicknessUpdater } from './trace-thickness-updater';

/**
 * Test suite for the trace thickness module.
 */
describe('TraceThickness', () => {
  let traceThickness: TraceThickness;
  let updater: TraceThicknessUpdater;

  beforeEach(() => {
    traceThickness = new TraceThickness({ traceThickness: 10 });
    updater = new TraceThicknessUpdater(traceThickness);
  });

  test('should initialize with correct thickness', () => {
    expect(traceThickness.getThickness()).toBe(10);
  });

  test('should update trace thickness', () => {
    traceThickness.setThickness(15);
    expect(traceThickness.getThickness()).toBe(15);
  });

  test('should throw error for invalid thickness', () => {
    expect(() => traceThickness.setThickness(0)).toThrowError('Trace thickness must be greater than 0.');
  });

  test('should update routing with trace thickness', () => {
    const consoleSpy = jest.spyOn(console, 'log');
    updater.updateRoutingWithTraceThickness();
    expect(consoleSpy).toHaveBeenCalledWith('Updating routing with trace thickness: 10 mils');
  });
});

