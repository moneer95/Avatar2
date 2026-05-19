/**
 * Character → viseme mapping for Monir.glb morph targets.
 * No external lipsync library — only the 15 viseme_* shapes on the model.
 */

export const VISEME_MORPH_NAMES = [
  "viseme_sil",
  "viseme_PP",
  "viseme_FF",
  "viseme_TH",
  "viseme_DD",
  "viseme_kk",
  "viseme_CH",
  "viseme_SS",
  "viseme_nn",
  "viseme_RR",
  "viseme_aa",
  "viseme_E",
  "viseme_I",
  "viseme_O",
  "viseme_U",
] as const;

export type VisemeId =
  | "sil"
  | "PP"
  | "FF"
  | "TH"
  | "DD"
  | "kk"
  | "CH"
  | "SS"
  | "nn"
  | "RR"
  | "aa"
  | "E"
  | "I"
  | "O"
  | "U";

/** Single ASCII letter / digraph → viseme id (suffix only, without viseme_ prefix). */
const LETTER_TO_VISEME: Record<string, VisemeId> = {
  a: "aa",
  b: "PP",
  c: "kk",
  d: "DD",
  e: "E",
  f: "FF",
  g: "kk",
  h: "sil",
  i: "I",
  j: "CH",
  k: "kk",
  l: "RR",
  m: "PP",
  n: "nn",
  o: "O",
  p: "PP",
  q: "kk",
  r: "RR",
  s: "SS",
  t: "TH",
  u: "U",
  v: "FF",
  w: "U",
  x: "kk",
  y: "I",
  z: "SS",
};

const DIGRAPHS: Record<string, VisemeId> = {
  th: "TH",
  ch: "CH",
  sh: "CH",
  ph: "FF",
  ng: "nn",
};

export function charToViseme(char: string): VisemeId {
  if (!char) return "sil";
  const lower = char.toLowerCase();
  if (LETTER_TO_VISEME[lower]) return LETTER_TO_VISEME[lower]!;
  return "sil";
}

/** Tokenize a word into viseme ids (handles common digraphs). */
export function wordToVisemes(word: string): VisemeId[] {
  const out: VisemeId[] = [];
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  let i = 0;
  while (i < w.length) {
    const pair = w.slice(i, i + 2);
    if (DIGRAPHS[pair]) {
      out.push(DIGRAPHS[pair]!);
      i += 2;
      continue;
    }
    out.push(charToViseme(w[i]!));
    i += 1;
  }
  return out.length ? out : ["sil"];
}

export interface VisemeTrack {
  visemes: VisemeId[];
  vtimes: number[];
  vdurations: number[];
}

export interface WordTimingPlan {
  words: string[];
  wtimes: number[];
  wdurations: number[];
}

/** Build a timed viseme track from words using per-character mapping. */
export function buildVisemeTrack(plan: WordTimingPlan): VisemeTrack {
  const visemes: VisemeId[] = [];
  const vtimes: number[] = [];
  const vdurations: number[] = [];

  for (let i = 0; i < plan.words.length; i++) {
    const word = plan.words[i]!;
    const wordStart = plan.wtimes[i]!;
    const wordDur = Math.max(50, plan.wdurations[i]!);
    const tokens = wordToVisemes(word);
    const slice = wordDur / tokens.length;

    for (let j = 0; j < tokens.length; j++) {
      visemes.push(tokens[j]!);
      vtimes.push(wordStart + j * slice);
      vdurations.push(Math.max(35, slice));
    }

    // Brief closed mouth between words
    visemes.push("sil");
    vtimes.push(wordStart + wordDur);
    vdurations.push(40);
  }

  return { visemes, vtimes, vdurations };
}
