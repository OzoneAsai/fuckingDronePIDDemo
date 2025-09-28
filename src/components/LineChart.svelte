<script>
  export let data = [];
  export let duration = 30;
  export let label = '';
  export let unit = '';
  export let min = undefined;
  export let max = undefined;
  export let format = (value) => value.toFixed(2);

  const padding = { top: 18, right: 18, bottom: 26, left: 44 };
  const width = 360;
  const height = 180;

  $: points = data.slice(-400);
  $: values = points.map((d) => d.value);
  $: yMin = min ?? (values.length ? Math.min(...values) : 0);
  $: yMax = max ?? (values.length ? Math.max(...values) : 1);
  $: safeMin = Number.isFinite(yMin) ? yMin : 0;
  $: safeMax = Number.isFinite(yMax) ? yMax : safeMin + 1;
  $: range = safeMax - safeMin === 0 ? 1 : safeMax - safeMin;
  $: gradId = `${label.replace(/\s+/g, '-') || 'chart'}-grad`;

  function scaleX(time) {
    return padding.left + (Math.min(Math.max(time, 0), duration) / duration) * (width - padding.left - padding.right);
  }

  function scaleY(value) {
    return padding.top + (height - padding.top - padding.bottom) * (1 - (value - safeMin) / range);
  }

  $: path = points.length
    ? points
        .map((sample, index) => `${index === 0 ? 'M' : 'L'}${scaleX(sample.time)},${scaleY(sample.value)}`)
        .join(' ')
    : '';

  $: lastValue = values.length ? values[values.length - 1] : 0;
</script>

<div class="chart">
  <div class="chart__header">
    <h3>{label}</h3>
    <span class="chart__value">{format(lastValue)} {unit}</span>
  </div>
  <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
    <defs>
      <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.7" />
        <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.1" />
      </linearGradient>
    </defs>
    <rect class="chart__bg" x="0" y="0" width={width} height={height} rx="20" ry="20" />
    <g class="chart__axes">
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} />
      <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} />
      <text x={padding.left - 10} y={padding.top + 10} text-anchor="end">{format(safeMax)}</text>
      <text x={padding.left - 10} y={height - padding.bottom} text-anchor="end">{format(safeMin)}</text>
      <text x={width - padding.right} y={height - padding.bottom + 18} text-anchor="end">{duration.toFixed(0)} s</text>
      <text x={padding.left} y={height - padding.bottom + 18} text-anchor="start">0 s</text>
    </g>
    {#if path}
      <path class="chart__line" d={path} />
      <path class="chart__fill" d={`${path} V${height - padding.bottom} H${padding.left} Z`} fill={`url(#${gradId})`} />
    {/if}
  </svg>
</div>

<style>
  .chart {
    background: rgba(15, 23, 42, 0.75);
    border-radius: 1.25rem;
    padding: 1rem 1.25rem;
    box-shadow: inset 0 1px 0 rgba(148, 163, 184, 0.12), 0 25px 40px rgba(2, 6, 23, 0.55);
    backdrop-filter: blur(12px);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .chart__header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    color: #e2e8f0;
  }

  .chart__header h3 {
    margin: 0;
    font-size: 0.95rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .chart__value {
    font-size: 1.1rem;
    font-variant-numeric: tabular-nums;
    color: #f8fafc;
  }

  svg {
    width: 100%;
    height: auto;
  }

  .chart__bg {
    fill: rgba(15, 23, 42, 0.85);
    stroke: rgba(59, 130, 246, 0.25);
    stroke-width: 2;
  }

  .chart__axes line {
    stroke: rgba(148, 163, 184, 0.25);
    stroke-width: 1;
  }

  .chart__axes text {
    fill: rgba(148, 163, 184, 0.65);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .chart__line {
    fill: none;
    stroke: #38bdf8;
    stroke-width: 3;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .chart__fill {
    stroke: none;
  }
</style>
