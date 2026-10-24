/** 点击音效：两个极短的 WebAudio 音，失败静默（没有声卡也不影响使用）。 */

export function createAudio() {
  let ctx = null;

  function context() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      return ctx;
    } catch {
      return null;
    }
  }

  function blip({ type, from, to, gain, duration }) {
    const audio = context();
    if (!audio) return;
    try {
      const now = audio.currentTime;
      const oscillator = audio.createOscillator();
      const envelope = audio.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(from, now);
      oscillator.frequency.exponentialRampToValueAtTime(to, now + duration * 0.7);
      envelope.gain.setValueAtTime(0.001, now);
      envelope.gain.exponentialRampToValueAtTime(gain, now + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);
      oscillator.connect(envelope).connect(audio.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    } catch {
      /* 忽略 */
    }
  }

  return {
    press: () => blip({ type: 'triangle', from: 520, to: 880, gain: 0.2, duration: 0.08 }),
    release: () => blip({ type: 'sine', from: 720, to: 360, gain: 0.18, duration: 0.11 }),
  };
}
