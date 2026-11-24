/**
 * Test support only: a stand-in for the browser's AudioContext that records
 * what was scheduled on it, so that `synth.ts` and `Sfx.ts` can be unit-tested
 * in Node, which has no Web Audio. It makes no sound and does no arithmetic
 * on samples: it answers "which sources are wired to the output, when do they
 * start and stop, and what do the gains on their way do over time".
 *
 * Never imported by game code. What the real thing sounds like is proven in a
 * browser (`offline.ts`, `e2e/audio.spec.ts`).
 */

type ParamEvent =
  | { readonly kind: 'set'; readonly value: number; readonly time: number }
  | { readonly kind: 'linear'; readonly value: number; readonly time: number }
  | { readonly kind: 'exponential'; readonly value: number; readonly time: number };

/** An AudioParam: remembers its automation and can say what value it gives at a time. */
export class FakeParam {
  value: number;
  events: ParamEvent[] = [];

  constructor(initial: number) {
    this.value = initial;
  }

  setValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'linear', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    if (value <= 0) throw new RangeError('an exponential ramp cannot reach 0 or below');
    this.events.push({ kind: 'exponential', value, time });
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.events = this.events.filter((event) => event.time < time);
    return this;
  }

  /** The value the automation gives at `time`; the plain `value` before the first event. */
  valueAt(time: number): number {
    let value = this.value;
    let since = -Infinity;
    for (const event of this.events) {
      if (event.time <= time) {
        value = event.value;
        since = event.time;
        continue;
      }
      if (event.kind === 'set' || since === -Infinity) return value;
      const share = (time - since) / (event.time - since);
      return event.kind === 'linear'
        ? value + (event.value - value) * share
        : value * Math.pow(event.value / value, share);
    }
    return value;
  }

  /** The largest value any event asks for (0 when there is none). */
  get peak(): number {
    return this.events.reduce((most, event) => Math.max(most, event.value), 0);
  }
}

export class FakeNode {
  readonly outputs: FakeNode[] = [];

  connect(destination: FakeNode): FakeNode {
    this.outputs.push(destination);
    return destination;
  }

  disconnect(): void {
    this.outputs.length = 0;
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

export class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
}

export class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);
}

export class FakeBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly data: Float32Array;

  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = new Float32Array(length);
  }

  getChannelData(): Float32Array {
    return this.data;
  }
}

export class FakeSource extends FakeNode {
  startTime: number | null = null;
  stopTime: number | null = null;
  stopCalls = 0;
  ended = false;
  onended: (() => void) | null = null;

  start(when = 0): void {
    if (this.startTime !== null) throw new Error('start() called twice');
    this.startTime = when;
  }

  stop(when = 0): void {
    if (this.startTime === null) throw new Error('stop() called before start()');
    this.stopTime = when;
    this.stopCalls += 1;
  }
}

export class FakeOscillator extends FakeSource {
  type = 'sine';
  readonly frequency = new FakeParam(440);
}

export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  offset = 0;

  override start(when = 0, offset = 0): void {
    super.start(when);
    this.offset = offset;
  }
}

/** Largest product of gains (at `time`) over the ways from `node` to `target`; 0 when there is no way. */
function gainTo(node: FakeNode, target: FakeNode, time: number, depth = 0): number {
  if (node === target) return 1;
  if (depth > 16) return 0;
  const own = node instanceof FakeGain ? Math.abs(node.gain.valueAt(time)) : 1;
  let best = 0;
  for (const next of node.outputs) best = Math.max(best, gainTo(next, target, time, depth + 1));
  return own * best;
}

export class FakeAudioContext {
  /** Every context constructed since `FakeAudioContext.reset()`. */
  static created: FakeAudioContext[] = [];
  /** When true, constructing a context throws, as on a device without audio output. */
  static broken = false;
  /** The `allowed` a new context starts with. */
  static allowedByDefault = true;

  static reset(): void {
    FakeAudioContext.created = [];
    FakeAudioContext.broken = false;
    FakeAudioContext.allowedByDefault = true;
  }

  currentTime = 0;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  sampleRate = 48000;
  /** false: resume() stays pending, as in a browser before any user gesture. `allow()` lets it through. */
  allowed = FakeAudioContext.allowedByDefault;
  readonly destination = new FakeNode();
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];
  readonly compressors: FakeCompressor[] = [];
  readonly buffers: FakeBuffer[] = [];
  resumeCalls = 0;
  suspendCalls = 0;
  private readonly listeners = new Set<() => void>();
  private waiting: (() => void)[] = [];

  constructor() {
    if (FakeAudioContext.broken) throw new Error('no audio device');
    FakeAudioContext.created.push(this);
  }

  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }

  createOscillator(): FakeOscillator {
    const node = new FakeOscillator();
    this.sources.push(node);
    return node;
  }

  createBufferSource(): FakeBufferSource {
    const node = new FakeBufferSource();
    this.sources.push(node);
    return node;
  }

  createBiquadFilter(): FakeFilter {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }

  createDynamicsCompressor(): FakeCompressor {
    const node = new FakeCompressor();
    this.compressors.push(node);
    return node;
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    const buffer = new FakeBuffer(channels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'statechange') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'statechange') this.listeners.delete(listener);
  }

  /** Like the real one: the state changes a moment later, not during the call. */
  resume(): Promise<void> {
    this.resumeCalls += 1;
    if (this.state === 'closed') return Promise.reject(new Error('closed'));
    return new Promise<void>((resolve) => {
      const run = (): void => {
        this.setState('running');
        resolve();
      };
      if (this.allowed) queueMicrotask(run);
      else this.waiting.push(run);
    });
  }

  suspend(): Promise<void> {
    this.suspendCalls += 1;
    return Promise.resolve().then(() => {
      this.setState('suspended');
    });
  }

  close(): Promise<void> {
    this.setState('closed');
    return Promise.resolve();
  }

  /** The browser grants audio (a user gesture happened): every waiting resume() goes through. */
  allow(): void {
    this.allowed = true;
    const waiting = this.waiting;
    this.waiting = [];
    for (const run of waiting) run();
  }

  /** Changes the state and tells the listeners, as the browser does (also on its own: a phone call, the screen lock). */
  setState(state: 'suspended' | 'running' | 'closed'): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  /** Lets time pass. Sources whose stop time has come end and call `onended`. */
  advance(seconds: number): void {
    this.currentTime += seconds;
    for (const source of this.sources) {
      if (!source.ended && source.stopTime !== null && source.stopTime <= this.currentTime) {
        source.ended = true;
        source.onended?.();
      }
    }
  }

  /** Sources that can be heard at `time`: started, not stopped, wired to the output, with a gain above 0 all the way. */
  audibleAt(time: number): FakeSource[] {
    return this.sources.filter(
      (source) =>
        source.startTime !== null &&
        source.startTime <= time &&
        (source.stopTime === null || source.stopTime > time) &&
        gainTo(source, this.destination, time) > 1e-9,
    );
  }

  /** Sources that are started and not yet over at `time`, whether or not they can be heard. */
  runningAt(time: number): FakeSource[] {
    return this.sources.filter(
      (source) =>
        source.startTime !== null && source.startTime <= time && (source.stopTime === null || source.stopTime > time),
    );
  }
}

/** Lets promise callbacks that are already due run (a resume() going through, for example). */
export async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}
