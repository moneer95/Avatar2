// Vendored from
//   https://raw.githubusercontent.com/met4citizen/TalkingHead/main/modules/playback-worklet.js
//
// The published GitHub tarball of TalkingHead ships without this file, but
// modules/talkinghead.mjs references it via:
//     new URL('./playback-worklet.js', import.meta.url)
// at top level. Bundlers (Vite) statically resolve that URL at build time, so
// the file must exist next to talkinghead.mjs. `scripts/patch-talkinghead.mjs`
// copies this file into node_modules on install.
class PlaybackWorklet extends AudioWorkletProcessor {
  static FSM = {
    IDLE: 0,
    PLAYING: 1,
  };

  constructor(options) {
    super();
    this.port.onmessage = this.handleMessage.bind(this);

    this._sampleRate = options?.processorOptions?.sampleRate || sampleRate;
    this._scale = 1 / 32768;

    const silenceDurationSeconds = 1.0;
    this._silenceThresholdBlocks = Math.ceil(
      (this._sampleRate * silenceDurationSeconds) / 128,
    );

    const metricsCfg = options?.processorOptions?.metrics || {};
    this._metricsEnabled = metricsCfg.enabled !== false;
    const intervalHz =
      typeof metricsCfg.intervalHz === "number" && metricsCfg.intervalHz > 0
        ? metricsCfg.intervalHz
        : 2;
    this._framesProcessed = 0;
    this._underrunBlocks = 0;
    this._maxQueueSamples = 0;
    this._lastMetricsSentAtFrame = 0;
    this._metricsIntervalFrames = Math.max(
      128,
      Math.round(this._sampleRate / intervalHz),
    );

    this.reset();
  }

  reset() {
    this._bufferQueue = [];
    this._currentChunk = null;
    this._currentChunkOffset = 0;
    this._state = PlaybackWorklet.FSM.IDLE;
    this._noMoreDataReceived = false;
    this._silenceFramesCount = 0;
    this._hasSentEnded = false;
    this._maxQueueSamples = 0;
  }

  handleMessage(event) {
    const { type, data } = event.data;

    if (type === "stop") {
      this.reset();
      if (this._metricsEnabled) {
        try {
          this.port.postMessage({
            type: "metrics",
            data: {
              state: PlaybackWorklet.FSM.IDLE,
              queuedSamples: 0,
              queuedMs: 0,
              maxQueuedMs: Math.round(
                (this._maxQueueSamples / this._sampleRate) * 1000,
              ),
              underrunBlocks: this._underrunBlocks,
              framesProcessed: this._framesProcessed,
            },
          });
        } catch (_) {}
      }
      return;
    }

    if (type === "no-more-data") {
      this._noMoreDataReceived = true;
      return;
    }

    if (type === "config-metrics" && data && typeof data === "object") {
      if ("enabled" in data) this._metricsEnabled = !!data.enabled;
      if (typeof data.intervalHz === "number" && data.intervalHz > 0) {
        const intervalHz = data.intervalHz;
        this._metricsIntervalFrames = Math.max(
          128,
          Math.round(this._sampleRate / intervalHz),
        );
      }
      this._lastMetricsSentAtFrame = this._framesProcessed;
      return;
    }

    if (type === "audioData" && data instanceof ArrayBuffer) {
      this._noMoreDataReceived = false;
      if (this._state === PlaybackWorklet.FSM.IDLE) {
        this._state = PlaybackWorklet.FSM.PLAYING;
        this.port.postMessage({ type: "playback-started" });
      }

      if (this._state === PlaybackWorklet.FSM.PLAYING) {
        this._bufferQueue.push(new Int16Array(data));
        this._silenceFramesCount = 0;
      }
    }
  }

  process(_inputs, outputs) {
    const outputChannel = outputs[0]?.[0];
    if (!outputChannel) return true;

    if (this._state !== PlaybackWorklet.FSM.PLAYING) {
      outputChannel.fill(0);
      return true;
    }

    const blockSize = outputChannel.length;
    let samplesCopied = 0;

    while (samplesCopied < blockSize) {
      if (
        !this._currentChunk ||
        this._currentChunkOffset >= this._currentChunk.length
      ) {
        if (this._bufferQueue.length > 0) {
          this._currentChunk = this._bufferQueue.shift();
          this._currentChunkOffset = 0;
        } else {
          const isTimedOut =
            this._silenceFramesCount > this._silenceThresholdBlocks;

          if (this._noMoreDataReceived || isTimedOut) {
            if (!this._hasSentEnded) {
              this.port.postMessage({ type: "playback-ended" });
              this._hasSentEnded = true;
            }
            if (this._metricsEnabled) {
              try {
                this.port.postMessage({
                  type: "metrics",
                  data: {
                    state: PlaybackWorklet.FSM.IDLE,
                    queuedSamples: 0,
                    queuedMs: 0,
                    maxQueuedMs: Math.round(
                      (this._maxQueueSamples / this._sampleRate) * 1000,
                    ),
                    underrunBlocks: this._underrunBlocks,
                    framesProcessed: this._framesProcessed,
                  },
                });
              } catch (_) {}
            }
            this.reset();
            break;
          } else {
            this._silenceFramesCount++;
            if (this._metricsEnabled) this._underrunBlocks++;
            break;
          }
        }
      }

      if (this._currentChunk) {
        const samplesToCopy = Math.min(
          blockSize - samplesCopied,
          this._currentChunk.length - this._currentChunkOffset,
        );
        const src = this._currentChunk;
        const baseSrc = this._currentChunkOffset;
        const baseDst = samplesCopied;
        const scale = this._scale;
        for (let i = 0; i < samplesToCopy; i++) {
          outputChannel[baseDst + i] = src[baseSrc + i] * scale;
        }

        this._currentChunkOffset += samplesToCopy;
        samplesCopied += samplesToCopy;
      }
    }

    if (samplesCopied < blockSize) {
      outputChannel.fill(0, samplesCopied);
    }

    if (this._metricsEnabled) {
      this._framesProcessed += blockSize;

      let queuedSamples = 0;
      if (this._currentChunk) {
        queuedSamples += Math.max(
          0,
          this._currentChunk.length - this._currentChunkOffset,
        );
      }
      for (let i = 0; i < this._bufferQueue.length; i++) {
        queuedSamples += this._bufferQueue[i].length;
      }
      if (queuedSamples > this._maxQueueSamples) {
        this._maxQueueSamples = queuedSamples;
      }

      if (
        this._framesProcessed - this._lastMetricsSentAtFrame >=
        this._metricsIntervalFrames
      ) {
        this._lastMetricsSentAtFrame = this._framesProcessed;
        try {
          this.port.postMessage({
            type: "metrics",
            data: {
              state: this._state,
              queuedSamples,
              queuedMs: Math.round((queuedSamples / this._sampleRate) * 1000),
              maxQueuedMs: Math.round(
                (this._maxQueueSamples / this._sampleRate) * 1000,
              ),
              underrunBlocks: this._underrunBlocks,
              framesProcessed: this._framesProcessed,
            },
          });
        } catch (_) {}
      }
    }

    return true;
  }
}

registerProcessor("playback-worklet", PlaybackWorklet);
