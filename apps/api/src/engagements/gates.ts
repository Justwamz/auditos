import type { PoolClient } from 'pg';
import type { EngagementState } from './service';

export interface GateCheck {
  gate: string;
  message: string;
  run: (tx: PoolClient, engagementId: string) => Promise<boolean>;
}

export interface GateBlocker {
  gate: string;
  message: string;
}

const registry = new Map<string, GateCheck[]>();
const key = (from: EngagementState, to: EngagementState) => `${from}>${to}`;

/** Feature modules register the checks they own, e.g. checklists register 'mandatoryChecklistComplete'. */
export function registerGate(from: EngagementState, to: EngagementState, check: GateCheck): void {
  const k = key(from, to);
  registry.set(k, [...(registry.get(k) ?? []).filter((c) => c.gate !== check.gate), check]);
}

export function gateFor(from: EngagementState, to: EngagementState): GateCheck[] {
  return registry.get(key(from, to)) ?? [];
}

export async function evaluateGates(tx: PoolClient, engagementId: string, from: EngagementState, to: EngagementState): Promise<GateBlocker[]> {
  const blockers: GateBlocker[] = [];
  for (const check of gateFor(from, to)) {
    if (!(await check.run(tx, engagementId))) blockers.push({ gate: check.gate, message: check.message });
  }
  return blockers;
}
