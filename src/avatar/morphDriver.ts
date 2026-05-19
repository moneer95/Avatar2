import { LipsyncEn } from "talkinghead/modules/lipsync-en.mjs";
import type { WordTimingPlan } from "./lipsync";

const LIP_DEBUG =
  import.meta.env.DEV || import.meta.env.VITE_LIPSYNC_DEBUG === "1";

function debug(message: string, details?: unknown): void {
  if (!LIP_DEBUG) return;
  if (details === undefined) {
    console.log(`[lipdebug][morph] ${message}`);
    return;
  }
  console.log(`[lipdebug][morph] ${message}`, details);
}

interface MorphMesh {
  morphTargetDictionary?: Record<string, number>;
  morphTargetInfluences?: number[];
}

interface VisemeCue {
  target: string;
  t0: number;
  t1: number;
  peak: number;
}

interface WordCue {
  word: string;
  t: number;
}

/**
 * Map an Oculus viseme key (as emitted by LipsyncEn) to the actual morph target
 * name(s) we'll try on the model. First match wins. Some GLBs use lowercase, some
 * use uppercase, some don't have rare visemes — we fall back to viseme_aa.
 */
const VISEME_CANDIDATES: Record<string, string[]> = {
  aa: ["viseme_aa", "viseme_AA", "mouthOpen", "jawOpen"],
  E: ["viseme_E", "viseme_e"],
  I: ["viseme_I", "viseme_i"],
  O: ["viseme_O", "viseme_o", "mouthFunnel"],
  U: ["viseme_U", "viseme_u", "mouthPucker"],
  PP: ["viseme_PP", "viseme_pp"],
  FF: ["viseme_FF", "viseme_ff"],
  TH: ["viseme_TH", "viseme_th"],
  DD: ["viseme_DD", "viseme_dd"],
  kk: ["viseme_kk", "viseme_KK"],
  CH: ["viseme_CH", "viseme_ch"],
  SS: ["viseme_SS", "viseme_ss"],
  nn: ["viseme_nn", "viseme_NN"],
  RR: ["viseme_RR", "viseme_rr"],
  sil: ["viseme_sil"],
};

const PEAK: Record<string, number> = {
  aa: 1.0,
  E: 0.85,
  I: 0.8,
  O: 1.0,
  U: 0.95,
  PP: 0.9,
  FF: 0.85,
  TH: 0.7,
  DD: 0.75,
  kk: 0.7,
  CH: 0.8,
  SS: 0.7,
  nn: 0.7,
  RR: 0.75,
  sil: 0,
};

export class MorphDriver {
  private meshes: MorphMesh[] = [];
  private lipsync = new LipsyncEn();
  private rafId = 0;
  private running = false;
  private startedAt = 0;
  private duration = 0;
  private cues: VisemeCue[] = [];
  private wordCues: WordCue[] = [];
  private wordIdx = 0;
  private onWord?: (word: string) => void;
  private active = new Map<string, number>();
  private resolved = new Map<string, string | null>();
  private generation = 0;
  private morphNameLookup = new Map<string, string>();
  private mouthTargets: string[] = [];
  private openTarget: string | null = null;
  private roundTarget: string | null = null;
  private closeTarget: string | null = null;

  attach(meshes: MorphMesh[]): void {
    this.meshes = meshes.filter(
      (m) =>
        m.morphTargetDictionary &&
        Array.isArray(m.morphTargetInfluences) &&
        Object.keys(m.morphTargetDictionary).length > 0,
    );
    this.resolved.clear();
    this.morphNameLookup.clear();
    const allNames = new Set<string>();
    for (const mesh of this.meshes) {
      for (const key of Object.keys(mesh.morphTargetDictionary ?? {})) {
        allNames.add(key);
        const low = key.toLowerCase();
        if (!this.morphNameLookup.has(low)) this.morphNameLookup.set(low, key);
      }
    }
    this.mouthTargets = [...allNames].filter((k) =>
      /(viseme|mouth|jaw|lip|tongue)/i.test(k),
    );
    this.openTarget = this.findBestTarget([
      "viseme_aa",
      "viseme_AA",
      "jawOpen",
      "mouthOpen",
      "mouthApeShape",
      /jaw.*open/i,
      /mouth.*open/i,
      /viseme.*aa/i,
      /open/i,
    ]);
    this.roundTarget = this.findBestTarget([
      "viseme_O",
      "viseme_U",
      "mouthFunnel",
      "mouthPucker",
      /funnel/i,
      /pucker/i,
      /round/i,
      /viseme.*o/i,
      /viseme.*u/i,
    ]);
    this.closeTarget = this.findBestTarget([
      "viseme_PP",
      "viseme_FF",
      "mouthClose",
      "mouthPress",
      /mouth.*close/i,
      /press/i,
      /lip/i,
      /viseme.*pp/i,
      /viseme.*ff/i,
    ]);
    debug("attach", {
      meshes: this.meshes.length,
      allMorphs: allNames.size,
      mouthTargets: this.mouthTargets.length,
      openTarget: this.openTarget,
      roundTarget: this.roundTarget,
      closeTarget: this.closeTarget,
      sampleKeys: [...allNames].slice(0, 18),
      sampleMouthKeys: this.mouthTargets.slice(0, 18),
    });
  }

  detach(): void {
    this.stop();
    this.meshes = [];
    this.resolved.clear();
    this.morphNameLookup.clear();
    this.mouthTargets = [];
    this.openTarget = null;
    this.roundTarget = null;
    this.closeTarget = null;
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.releaseAll();
    this.cues = [];
    this.wordCues = [];
    this.wordIdx = 0;
  }

  play(
    plan: WordTimingPlan,
    durationMs: number,
    onWord?: (word: string) => void,
  ): void {
    if (!this.meshes.length || !plan.words.length) return;
    this.stop();

    this.onWord = onWord;
    this.duration = Math.max(durationMs, 0);
    this.cues = this.buildCues(plan);
    this.wordCues = plan.words.map((word, i) => ({
      word,
      t: Math.max(0, plan.wtimes[i] ?? 0),
    }));
    this.wordIdx = 0;
    this.startedAt = performance.now();
    this.running = true;
    debug("play", {
      words: plan.words.length,
      cues: this.cues.length,
      durationMs,
      sampleCues: this.cues.slice(0, 4),
    });
    const gen = this.generation;
    const loop = () => {
      if (!this.running || gen !== this.generation) return;
      this.tick();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private tick(): void {
    const now = performance.now();
    const t = now - this.startedAt;
    if (t > this.duration + 250) {
      this.stop();
      return;
    }

    while (
      this.wordIdx < this.wordCues.length &&
      t >= this.wordCues[this.wordIdx]!.t
    ) {
      const w = this.wordCues[this.wordIdx]!.word;
      this.wordIdx++;
      this.onWord?.(w);
    }

    const next = new Map<string, number>();
    for (const cue of this.cues) {
      if (t < cue.t0 || t > cue.t1) continue;
      const dur = Math.max(1, cue.t1 - cue.t0);
      const local = (t - cue.t0) / dur;
      let env: number;
      if (local < 0.25) env = local / 0.25;
      else if (local > 0.75) env = (1 - local) / 0.25;
      else env = 1;
      const v = env * cue.peak;
      const prev = next.get(cue.target) ?? 0;
      if (v > prev) next.set(cue.target, v);
    }

    for (const [name] of this.active) {
      if (!next.has(name)) this.writeMorph(name, 0);
    }
    for (const [name, val] of next) this.writeMorph(name, val);
    this.active = next;
  }

  private buildCues(plan: WordTimingPlan): VisemeCue[] {
    const cues: VisemeCue[] = [];
    for (let i = 0; i < plan.words.length; i++) {
      const word = plan.words[i]!;
      const wt = Math.max(0, plan.wtimes[i] ?? 0);
      const wd = Math.max(60, plan.wdurations[i] ?? 200);
      const v = this.lipsync.wordsToVisemes(word) as {
        visemes: string[];
        times: number[];
        durations: number[];
      };
      if (!v.visemes.length) continue;
      const cuesBeforeWord = cues.length;
      const last = v.visemes.length - 1;
      const relEnd = (v.times[last] ?? 0) + (v.durations[last] ?? 1);
      const scale = relEnd > 0 ? wd / relEnd : wd;
      for (let j = 0; j < v.visemes.length; j++) {
        const key = v.visemes[j]!;
        const target = this.resolveTarget(key);
        if (!target) continue;
        const t0 = wt + (v.times[j] ?? 0) * scale;
        const len = Math.max(60, (v.durations[j] ?? 1) * scale);
        const t1 = t0 + len;
        const peak = PEAK[key] ?? 0.8;
        if (peak <= 0) continue;
        cues.push({ target, t0, t1, peak });
      }
      if (cues.length === cuesBeforeWord) {
        const fallback = this.pickWordFallbackTarget(word);
        if (fallback) {
          cues.push({
            target: fallback,
            t0: wt,
            t1: wt + wd,
            peak: 0.78,
          });
        }
      }
    }
    return cues;
  }

  private resolveTarget(visemeKey: string): string | null {
    if (this.resolved.has(visemeKey)) return this.resolved.get(visemeKey)!;
    const candidates = VISEME_CANDIDATES[visemeKey] ?? [`viseme_${visemeKey}`];
    let found: string | null = null;
    for (const name of candidates) {
      const resolvedName = this.resolveName(name);
      if (resolvedName) {
        found = resolvedName;
        break;
      }
    }
    if (!found && visemeKey !== "aa") {
      found = this.pickCategoryFallback(visemeKey);
    } else if (!found) {
      found = this.openTarget;
    }
    this.resolved.set(visemeKey, found);
    return found;
  }

  private resolveName(name: string): string | null {
    return this.morphNameLookup.get(name.toLowerCase()) ?? null;
  }

  private findBestTarget(
    candidates: Array<string | RegExp>,
    from?: string[],
  ): string | null {
    const names = from ?? [...this.morphNameLookup.values()];
    for (const c of candidates) {
      if (typeof c === "string") {
        const exact = this.resolveName(c);
        if (exact) return exact;
        continue;
      }
      const found = names.find((n) => c.test(n));
      if (found) return found;
    }
    return null;
  }

  private pickCategoryFallback(visemeKey: string): string | null {
    const key = visemeKey.toUpperCase();
    if (key === "O" || key === "U") return this.roundTarget ?? this.openTarget;
    if (key === "PP" || key === "FF") return this.closeTarget ?? this.openTarget;
    if (key === "E" || key === "I") {
      return (
        this.findBestTarget(
          [/smile/i, /stretch/i, /mouth.*left|mouth.*right/i],
          this.mouthTargets,
        ) ?? this.openTarget
      );
    }
    return this.openTarget;
  }

  private pickWordFallbackTarget(word: string): string | null {
    const w = word.toLowerCase();
    if (/[ou]/.test(w) && this.roundTarget) return this.roundTarget;
    if (/^[mbpfv]/.test(w) && this.closeTarget) return this.closeTarget;
    return this.openTarget ?? this.mouthTargets[0] ?? null;
  }

  private writeMorph(name: string, value: number): void {
    for (const mesh of this.meshes) {
      const idx = mesh.morphTargetDictionary?.[name];
      if (idx === undefined) continue;
      const arr = mesh.morphTargetInfluences;
      if (!arr || idx >= arr.length) continue;
      arr[idx] = value;
    }
  }

  private releaseAll(): void {
    for (const [name] of this.active) this.writeMorph(name, 0);
    this.active.clear();
  }
}
