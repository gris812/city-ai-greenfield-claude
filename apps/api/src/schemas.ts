/** zod schemas for every client → server payload (HTTP bodies and WebSocket messages). */
import { z } from 'zod';

export const LatLngSchema = z.object({ lat: z.number().gte(-90).lte(90), lng: z.number().gte(-180).lte(180) });

export const FixSchema = LatLngSchema.extend({
  t: z.number().finite(),
  accuracyM: z.number().nullable().optional(),
  speedMps: z.number().nullable().optional(),
  headingDeg: z.number().nullable().optional(),
  altitudeM: z.number().nullable().optional(),
  source: z.enum(['gps', 'network', 'fused', 'simulated', 'replay']).default('gps'),
});

export const ContextFrameSchema = z.object({
  sessionId: z.string().optional(),
  seq: z.number().int().nonnegative(),
  fixes: z.array(FixSchema).max(120),
  route: z
    .object({ polyline: z.array(LatLngSchema).min(2).max(5000), destinationName: z.string().max(200).optional(), source: z.enum(['navigation_handoff', 'user', 'replay']) })
    .nullable()
    .optional(),
  appState: z.enum(['foreground', 'background', 'locked']).default('foreground'),
  audio: z
    .object({
      playing: z.boolean(),
      planId: z.string().max(200).nullable().optional(),
      segmentIndex: z.number().int().nullable().optional(),
      offsetMs: z.number().nullable().optional(),
      outputRoute: z.enum(['speaker', 'headphones', 'bluetooth', 'carplay', 'android_auto', 'unknown']).default('unknown'),
    })
    .default({ playing: false, outputRoute: 'unknown' }),
  lastInteractionAt: z.number().nullable().optional(),
  clientTime: z.number().finite(),
  simulated: z.boolean().default(false),
});

export const UtteranceSchema = z.object({
  text: z.string().max(1000),
  utteranceId: z.string().max(100).optional(),
  sttProvider: z.string().max(50).optional(),
  speechEndAt: z.number().optional(),
});

export const ControlSchema = z.object({
  action: z.enum(['skip', 'pause', 'resume', 'stop', 'repeat', 'not_that_one', 'quieter', 'chattier', 'interrupt']),
  at: z.number().optional(),
});

export const AudioProgressSchema = z.object({
  planId: z.string().max(200),
  segmentIndex: z.number().int().nonnegative().default(0),
  offsetMs: z.number().nonnegative().default(0),
  state: z.enum(['playing', 'finished', 'stopped']),
});

export const WsMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('context') }).extend(ContextFrameSchema.shape),
  z.object({ type: z.literal('audio_progress') }).extend(AudioProgressSchema.shape),
  z.object({ type: z.literal('utterance') }).extend(UtteranceSchema.shape),
  z.object({ type: z.literal('control') }).extend(ControlSchema.shape),
  z.object({ type: z.literal('ack'), seq: z.number().int() }),
  z.object({ type: z.literal('resume'), lastDirectiveSeq: z.number().int().nonnegative() }),
  z.object({ type: z.literal('ping'), t: z.number().optional() }),
]);
export type WsMessage = z.infer<typeof WsMessageSchema>;

export const CreateSessionSchema = z.object({
  guideId: z.string().max(50).default('ida'),
  locale: z.string().min(2).max(20).default('en-US'),
  units: z.enum(['metric', 'imperial']).optional(),
  simulated: z.boolean().default(false),
  client: z.object({ platform: z.string().max(30), appVersion: z.string().max(40) }).partial().default({}),
});

export const NearbyRequestSchema = z.object({
  sessionId: z.string().uuid(),
  query: z.string().min(1).max(200),
  category: z.string().max(40).optional(),
  location: LatLngSchema,
});

export const FeedbackSchema = z.object({
  sessionId: z.string().uuid(),
  planId: z.string().max(200).optional(),
  rating: z.number().int().min(1).max(5),
  reason: z.string().max(500).optional(),
});

export const RealtimeTokenSchema = z.object({ sessionId: z.string().uuid(), provider: z.string().max(30).optional() });

export const RealtimeUsageSchema = z.object({
  sessionId: z.string().uuid(),
  provider: z.string().max(30),
  model: z.string().max(80),
  userAudioS: z.number().nonnegative().max(7200),
  assistantAudioS: z.number().nonnegative().max(7200),
  connectMs: z.number().nonnegative().optional(),
});
