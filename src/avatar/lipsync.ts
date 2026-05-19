import type { AlignmentSegment, AudioPacket } from "./types";
import type { WordTimingPlan } from "./visemeMap";

export type { VisemeTrack, WordTimingPlan } from "./visemeMap";
export { buildVisemeTrack, charToViseme, wordToVisemes } from "./visemeMap";

/** Resolve word timings from Audiofish fields (or build from alignment / text). */
export function resolveWordTimings(
  packet: Pick<
    AudioPacket,
    "words" | "wtimes" | "wdurations" | "caption" | "alignment"
  >,
  audioMs: number,
  chunkOffsetSec?: number,
): WordTimingPlan | null {
  const direct = fromDirectArrays(packet.words, packet.wtimes, packet.wdurations);
  if (direct) return finalizeTimings(direct, audioMs, chunkOffsetSec);

  const fromAlign = fromAlignment(packet.alignment);
  if (fromAlign) return finalizeTimings(fromAlign, audioMs, chunkOffsetSec);

  const text = packet.caption?.trim();
  if (text && audioMs > 0) {
    return distributeWordsOverDuration(text.split(/\s+/).filter(Boolean), audioMs);
  }

  return null;
}

/** Fish often sends seconds; our pipeline expects milliseconds. */
export function normalizeWordTimingsMs(
  wtimes: number[],
  wdurations: number[],
  audioMs: number,
): { wtimes: number[]; wdurations: number[] } {
  if (!wtimes.length) return { wtimes: [], wdurations: [] };
  const last = wtimes[wtimes.length - 1]! + wdurations[wdurations.length - 1]!;
  if (last > 0 && last < 180 && audioMs > last * 4) {
    return {
      wtimes: wtimes.map((t) => t * 1000),
      wdurations: wdurations.map((d) => d * 1000),
    };
  }
  return { wtimes: wtimes.slice(), wdurations: wdurations.slice() };
}

/** Shift session-absolute word times to chunk-local 0. */
export function rebaseWordTimingsToChunk(
  wtimes: number[],
  wdurations: number[],
  audioMs: number,
  chunkOffsetSec?: number,
): { wtimes: number[]; wdurations: number[] } {
  let t = wtimes.slice();
  if (!t.length) return { wtimes: t, wdurations: wdurations.slice() };

  const minT = Math.min(...t);
  const maxT = Math.max(...t);

  if (chunkOffsetSec != null && chunkOffsetSec > 0.01) {
    const offMs = chunkOffsetSec * 1000;
    if (minT >= offMs * 0.85 && maxT > audioMs * 1.2) {
      t = t.map((x) => x - offMs);
    }
  }

  const rebasedMin = Math.min(...t);
  if (rebasedMin > 5 && rebasedMin > audioMs * 0.25) {
    t = t.map((x) => x - rebasedMin);
  }

  return { wtimes: t, wdurations: wdurations.slice() };
}

function finalizeTimings(
  plan: WordTimingPlan,
  audioMs: number,
  chunkOffsetSec?: number,
): WordTimingPlan {
  let { wtimes, wdurations } = normalizeWordTimingsMs(
    plan.wtimes,
    plan.wdurations,
    audioMs,
  );
  ({ wtimes, wdurations } = rebaseWordTimingsToChunk(
    wtimes,
    wdurations,
    audioMs,
    chunkOffsetSec,
  ));
  return { words: plan.words, wtimes, wdurations };
}

function fromDirectArrays(
  words?: string[],
  wtimes?: number[],
  wdurations?: number[],
): WordTimingPlan | null {
  if (
    !words?.length ||
    !wtimes?.length ||
    !wdurations?.length ||
    words.length !== wtimes.length ||
    words.length !== wdurations.length
  ) {
    return null;
  }
  const out: WordTimingPlan = { words: [], wtimes: [], wdurations: [] };
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!.trim();
    if (!w) continue;
    out.words.push(w);
    out.wtimes.push(wtimes[i]!);
    out.wdurations.push(wdurations[i]!);
  }
  return out.words.length ? out : null;
}

function fromAlignment(alignment?: {
  segments?: AlignmentSegment[];
}): WordTimingPlan | null {
  const segments = alignment?.segments;
  if (!segments?.length) return null;

  const words: string[] = [];
  const wtimes: number[] = [];
  const wdurations: number[] = [];

  for (const seg of segments) {
    const text = seg.text?.trim();
    if (!text) continue;
    const parts = text.split(/\s+/).filter(Boolean);
    if (!parts.length) continue;

    const segStartMs = Math.max(0, seg.start * 1000);
    const segDurMs = Math.max(50, (seg.end - seg.start) * 1000);
    const weights = parts.map((p) => Math.max(1, p.length));
    const sum = weights.reduce((a, b) => a + b, 0) || 1;

    let t = segStartMs;
    for (let i = 0; i < parts.length; i++) {
      const dur = (weights[i]! / sum) * segDurMs;
      words.push(parts[i]!);
      wtimes.push(t);
      wdurations.push(dur);
      t += dur;
    }
  }

  return words.length ? { words, wtimes, wdurations } : null;
}

function distributeWordsOverDuration(
  words: string[],
  audioMs: number,
): WordTimingPlan | null {
  if (!words.length || audioMs <= 0) return null;

  const weights = words.map((w) => Math.max(1, w.length));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const budget = audioMs * 0.94;
  let t = audioMs * 0.02;

  const wtimes: number[] = [];
  const wdurations: number[] = [];

  for (let i = 0; i < words.length; i++) {
    const dur = (weights[i]! / sum) * budget;
    wtimes.push(t);
    wdurations.push(dur);
    t += dur;
  }

  return { words, wtimes, wdurations };
}

export function scaleWordTimings(
  wtimes: number[],
  wdurations: number[],
  audioMs: number,
): { wtimes: number[]; wdurations: number[] } {
  const last = wtimes[wtimes.length - 1]! + wdurations[wdurations.length - 1]!;
  if (last <= 0 || !Number.isFinite(last)) {
    return { wtimes: wtimes.slice(), wdurations: wdurations.slice() };
  }
  const scale = audioMs / last;
  if (Math.abs(scale - 1) < 0.01) {
    return { wtimes: wtimes.slice(), wdurations: wdurations.slice() };
  }
  return {
    wtimes: wtimes.map((t) => t * scale),
    wdurations: wdurations.map((d) => d * scale),
  };
}
