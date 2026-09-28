/**
 * Build-time showcase data for the marketing site. Everything here is REAL output of the
 * production core pipeline (packages/core) as recorded by the deterministic replay harness
 * (benchmark/replay/*.json) over synthetic traces and fixture POI packs (D-005). The site
 * labels it as a simulated replay; it is not field data and not a usage claim.
 */
import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NowPlayingView } from '@/components/companion/Companion';

interface StoryRec {
  name: string;
  text: string;
  segments?: number;
  playedS: number;
  spatialCue?: string | null;
  regime: string;
  kind: string;
}
interface ReplayFile {
  summary: { scenario: string; durationS: number; storiesStarted: number; orientations: number; silenceRatio: number; maxSilentGapS: number; guide: string };
  stories: StoryRec[];
}

function load(name: string): ReplayFile | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), '..', '..', 'benchmark', 'replay', `${name}.json`), 'utf8')) as ReplayFile;
  } catch {
    return null;
  }
}

function sentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+(\s|$)/g)?.map((s) => s.trim()) ?? [text];
}

function toView(rec: StoryRec, guideId: 'ida' | 'emil', segmentIndex: number, progress: number): NowPlayingView {
  const ss = sentences(rec.text);
  const n = Math.max(1, rec.segments ?? 1);
  const per = Math.ceil(ss.length / n);
  const groups: string[] = [];
  for (let i = 0; i < n; i++) groups.push(ss.slice(i * per, (i + 1) * per).join(' '));
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  const total = words(rec.text) || 1;
  return {
    planId: `showcase:${rec.name}`,
    guideId,
    guideName: guideId === 'ida' ? 'Ida' : 'Emil',
    placeName: rec.name,
    segments: groups.filter(Boolean).map((g) => ({ text: g, durationMs: Math.round((words(g) / total) * rec.playedS * 1000) })),
    segmentIndex,
    segmentProgress: progress,
    status: 'playing',
    spatialCue: rec.spatialCue ?? null,
    audio: 'server',
  };
}

export interface Showcase {
  walking: NowPlayingView | null;
  driving: { hero: string; secondary: string } | null;
  interstate: { minutes: number; stories: number; quietPct: number; longestQuietMin: number } | null;
}

export function getShowcase(): Showcase {
  const art = load('art-institute-walk');
  const gg = load('golden-gate');
  const i40 = load('interstate');
  const walkStory = art?.stories.find((s) => s.kind === 'story') ?? null;
  const driveStory = i40?.stories.find((s) => s.kind === 'story' && s.regime === 'highway_driving' && s.spatialCue) ?? gg?.stories.find((s) => s.kind === 'story') ?? null;
  return {
    walking: walkStory ? toView(walkStory, 'ida', 1, 0.35) : null,
    driving: driveStory
      ? {
          hero: `${driveStory.name}`,
          secondary: `Emil · ${driveStory.spatialCue ?? 'ahead'}`,
        }
      : null,
    interstate: i40
      ? {
          minutes: Math.round(i40.summary.durationS / 60),
          stories: i40.summary.storiesStarted,
          quietPct: Math.round(i40.summary.silenceRatio * 1000) / 10,
          longestQuietMin: Math.round(i40.summary.maxSilentGapS / 60),
        }
      : null,
  };
}
