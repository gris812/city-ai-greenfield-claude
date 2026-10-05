/**
 * Built-in Guide profiles. Guides differ in voice, angle preference and framing —
 * never in facts (D-009). Voice ids are benchmark candidates (D-010).
 */
import type { GuideProfile } from '../contracts.js';
import idaJson from './ida.json' with { type: 'json' };
import emilJson from './emil.json' with { type: 'json' };

export const IDA: GuideProfile = idaJson as GuideProfile;
export const EMIL: GuideProfile = emilJson as GuideProfile;
export const GUIDES: readonly GuideProfile[] = [IDA, EMIL];
export const DEFAULT_GUIDE_ID = IDA.id;
export function guideById(id: string): GuideProfile | undefined {
  return GUIDES.find((g) => g.id === id);
}
