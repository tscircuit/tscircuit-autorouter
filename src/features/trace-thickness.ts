// TraceThickness.ts

/**
 * Module to handle the trace thickness parameter for routing.
 * Adds trace thickness parameter in routing calculations.
 */

export interface TraceThicknessOptions {
  traceThickness: number;  // in mils
}

export class TraceThickness {
  private traceThickness: number;

  constructor(options: TraceThicknessOptions) {
    this.traceThickness = options.traceThickness;
  }

  getThickness(): number {
    return this.traceThickness;
  }

  setThickness(thickness: number): void {
    if (thickness <= 0) {
      throw new Error('Trace thickness must be greater than 0.');
    }
    this.traceThickness = thickness;
  }
}

