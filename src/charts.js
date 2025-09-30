export function createHistoryChart(canvas, { range = [0, 1], color = '#22d3ee', background = 'rgba(15,23,42,0.85)', timeWindow = 30 } = {}) {
  const ctx = canvas.getContext('2d');
  const samples = [];
  const options = { range: [...range], color, background, timeWindow };

  function draw() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.lineWidth = 1;
    const gridLines = 4;
    for (let i = 1; i < gridLines; i += 1) {
      const y = (height / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (samples.length < 2) {
      return;
    }

    const [minY, maxY] = options.range;
    const rangeY = Math.max(1e-6, maxY - minY);
    const span = Math.max(1e-6, options.timeWindow);
    const lastTime = samples[samples.length - 1].time;
    const startTime = Math.max(0, lastTime - span);

    ctx.strokeStyle = options.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    samples.forEach((sample, index) => {
      const xNorm = Math.min(1, Math.max(0, (sample.time - startTime) / span));
      const x = xNorm * width;
      const yNorm = Math.min(1, Math.max(0, (sample.value - minY) / rangeY));
      const y = height - yNorm * height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function push(sample) {
    if (!sample || !Number.isFinite(sample.time) || !Number.isFinite(sample.value)) return;
    if (samples.length && sample.time + 0.01 < samples[samples.length - 1].time) {
      samples.length = 0;
    }
    samples.push(sample);
    while (samples.length && sample.time - samples[0].time > options.timeWindow + 0.25) {
      samples.shift();
    }
    draw();
  }

  function clear() {
    samples.length = 0;
    draw();
  }

  function setRange(min, max) {
    options.range = [min, max];
    draw();
  }

  function setTimeWindow(value) {
    options.timeWindow = Math.max(0.1, value);
    draw();
  }

  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => draw()) : null;
  resizeObserver?.observe(canvas);
  window.addEventListener('resize', draw);
  draw();

  return {
    push,
    clear,
    setRange,
    setTimeWindow,
    destroy() {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', draw);
    }
  };
}
