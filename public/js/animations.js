const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function animateNumber(element, targetValue, options = {}) {
  const {
    duration = 600,
    decimals = null,
    prefix = '',
    suffix = '',
    formatter = null
  } = options;

  const target = Number(targetValue) || 0;
  const startValue = Number(element.dataset.value) || 0;

  if (prefersReducedMotion || startValue === target) {
    element.dataset.value = String(target);
    element.textContent = formatAnimatedValue(target, { decimals, prefix, suffix, formatter });
    return Promise.resolve();
  }

  const startTime = performance.now();

  return new Promise((resolve) => {
    function frame(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      const current = startValue + (target - startValue) * eased;

      element.dataset.value = String(current);
      element.textContent = formatAnimatedValue(current, { decimals, prefix, suffix, formatter });

      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        element.dataset.value = String(target);
        element.textContent = formatAnimatedValue(target, { decimals, prefix, suffix, formatter });
        resolve();
      }
    }

    requestAnimationFrame(frame);
  });
}

function formatAnimatedValue(value, { decimals, prefix, suffix, formatter }) {
  if (formatter) {
    return formatter(value);
  }
  if (decimals !== null) {
    return `${prefix}${value.toFixed(decimals)}${suffix}`;
  }
  return `${prefix}${Math.round(value)}${suffix}`;
}

function showView(element) {
  if (!element) return;

  element.classList.remove('hidden', 'is-leaving');
  element.classList.add('is-entering');

  requestAnimationFrame(() => {
    element.classList.add('is-visible');
    element.classList.remove('is-entering');
  });
}

function hideView(element) {
  if (!element || element.classList.contains('hidden')) return Promise.resolve();

  if (prefersReducedMotion) {
    element.classList.add('hidden');
    element.classList.remove('is-visible', 'is-leaving', 'is-entering');
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    element.classList.add('is-leaving');
    element.classList.remove('is-visible');

    const onEnd = (event) => {
      if (event.target !== element) return;
      element.removeEventListener('transitionend', onEnd);
      element.classList.add('hidden');
      element.classList.remove('is-leaving', 'is-entering');
      resolve();
    };

    element.addEventListener('transitionend', onEnd);
    setTimeout(resolve, 450);
  });
}

async function hideViews(elements) {
  await Promise.all(elements.filter(Boolean).map((el) => hideView(el)));
}

class WaveformCanvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rafId = null;
    this.phase = 0;
    this.bars = [];
    this.mode = 'idle';
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
  }

  stop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  setStaticPeaks(peaks) {
    this.mode = 'static';
    this.bars = peaks;
    this.stop();
    this.drawStatic();
  }

  setLive(barCount = 40) {
    this.mode = 'live';
    this.bars = Array.from({ length: barCount }, () => 0.2);
    this.stop();
    this.tickLive();
  }

  setProgress(progressPercent) {
    this.progress = Math.max(0, Math.min(100, progressPercent)) / 100;
  }

  drawStatic() {
    const { ctx, width, height, bars } = this;
    ctx.clearRect(0, 0, width, height);

    const gap = 2;
    const barWidth = (width - gap * (bars.length - 1)) / bars.length;
    const centerY = height / 2;

    bars.forEach((peak, index) => {
      const barHeight = Math.max(4, peak * (height - 8));
      const x = index * (barWidth + gap);
      const gradient = ctx.createLinearGradient(0, centerY - barHeight, 0, centerY + barHeight);
      gradient.addColorStop(0, 'rgba(107, 138, 253, 0.95)');
      gradient.addColorStop(1, 'rgba(61, 214, 140, 0.55)');

      ctx.fillStyle = gradient;
      const y = centerY - barHeight / 2;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, barWidth, barHeight, 2);
      } else {
        ctx.rect(x, y, barWidth, barHeight);
      }
      ctx.fill();
    });
  }

  tickLive() {
    const animate = () => {
      if (this.mode !== 'live') return;

      const progressBoost = (this.progress || 0) * 0.35;
      this.phase += 0.08 + progressBoost * 0.05;

      this.bars = this.bars.map((_, index) => {
        const wave = Math.sin(this.phase + index * 0.45) * 0.5 + 0.5;
        const second = Math.cos(this.phase * 0.7 + index * 0.2) * 0.25 + 0.25;
        return 0.12 + (wave * 0.55 + second * 0.3 + progressBoost * 0.4);
      });

      this.drawStatic();
      this.rafId = requestAnimationFrame(animate);
    };

    this.rafId = requestAnimationFrame(animate);
  }

  clear() {
    this.stop();
    this.mode = 'idle';
    this.ctx.clearRect(0, 0, this.width, this.height);
  }
}

async function decodeAudioPeaks(file, barCount = 80) {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContext();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channel = audioBuffer.getChannelData(0);
    const maxSamples = Math.min(channel.length, audioBuffer.sampleRate * 90);
    const blockSize = Math.floor(maxSamples / barCount);
    const peaks = [];

    for (let i = 0; i < barCount; i += 1) {
      const start = i * blockSize;
      let peak = 0;
      for (let j = 0; j < blockSize && start + j < channel.length; j += 1) {
        const value = Math.abs(channel[start + j]);
        if (value > peak) peak = value;
      }
      peaks.push(Math.min(1, peak * 2.5));
    }

    return peaks;
  } finally {
    await audioContext.close();
  }
}

function generateFallbackPeaks(barCount = 80) {
  return Array.from({ length: barCount }, (_, index) => {
    const center = barCount / 2;
    const dist = Math.abs(index - center) / center;
    return 0.15 + (1 - dist) * (0.35 + Math.random() * 0.35);
  });
}
