export type Framework = 'IFRS_SME' | 'FULL_IFRS';
export type FrameworkVersion = 'IFRS_SME_2E' | 'IFRS_SME_3E';

export class UnsupportedFrameworkError extends Error {
  constructor(framework: string) {
    super(`Framework ${framework} is not supported yet`);
    this.name = 'UnsupportedFrameworkError';
  }
}

const THIRD_EDITION_EFFECTIVE = '2027-01-01';

export function resolveFramework(framework: Framework, periodStart: string): FrameworkVersion {
  if (framework !== 'IFRS_SME') throw new UnsupportedFrameworkError(framework);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || Number.isNaN(Date.parse(periodStart))) {
    throw new Error(`Invalid period start: ${periodStart}`);
  }
  return periodStart >= THIRD_EDITION_EFFECTIVE ? 'IFRS_SME_3E' : 'IFRS_SME_2E';
}
