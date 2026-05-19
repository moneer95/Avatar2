import type { WordTimingPlan } from "./visemeMap";

/**
 * Per-word live captions (TalkingHead subtitle queue is not used).
 */
export class MorphDriver {
  private captionTimers: ReturnType<typeof setTimeout>[] = [];
  private generation = 0;

  stop(): void {
    this.generation += 1;
    for (const id of this.captionTimers) clearTimeout(id);
    this.captionTimers = [];
  }

  scheduleCaptions(
    plan: WordTimingPlan,
    onWord?: (word: string) => void,
  ): void {
    if (!onWord || !plan.words.length) return;
    const gen = this.generation;
    for (let i = 0; i < plan.words.length; i++) {
      const word = plan.words[i]!;
      const delay = Math.max(0, plan.wtimes[i]!);
      const id = setTimeout(() => {
        if (this.generation === gen) onWord(word);
      }, delay);
      this.captionTimers.push(id);
    }
  }
}
