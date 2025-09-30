import Sk from 'skulpt';
import './app.css';
import { createHangarViewport } from './viewport.js';
import { createHistoryChart } from './charts.js';
import { airframe } from './lib/airframeData.js';
import { propulsionLimits } from './lib/propulsion.js';
import { radiansToDegrees, clamp } from './lib/math.js';

const timelineDuration = 30;
const FIELD_HEIGHT = airframe.env.fieldHeight ?? 50;
const ALTITUDE_SCORE_BAND = { min: 23, max: 26 };
const ANALOG_MAX_POWER = 255;
const MAX_RPM = Number(propulsionLimits.maxRpm ?? 1) || 1;
const HOVER_RPM = Number(propulsionLimits.hoverRpm ?? MAX_RPM * 0.4) || 0;
const HOVER_ANALOG = Math.round(
  Math.max(0, Math.min(((HOVER_RPM / MAX_RPM) || 0) * ANALOG_MAX_POWER, ANALOG_MAX_POWER))
);
const ALTITUDE_TARGET = (ALTITUDE_SCORE_BAND.min + ALTITUDE_SCORE_BAND.max) / 2;
const defaultPython = `# === Automation bootstrap ===
# prop_1 は第一象限 (カメラを上にしたときに前右) のロータです。
# prop_2, prop_3, prop_4 は反時計回りに配置されています。
#
# このデモでは command()/updateRot() を使わず、prop_*.power() で
# ロータのアナログ出力を直接制御します。IMU・高度センサーに基づく
# PID で 23–26 m の高度コリドーを狙います。
TARGET_ALTITUDE = ${ALTITUDE_TARGET.toFixed(2)}
COLLECTIVE_MIN = 60.0
COLLECTIVE_MAX = 220.0
IDLE_POWER = 55.0
SPINUP_DELAY = 0.15
SPINUP_RAMP = 1.0
ALT_KP = 6.5
ALT_KI = 1.6
ALT_KD = 9.0
ALT_I_LIMIT = 8.0
ROLL_P = 3.0
ROLL_D = 0.12
PITCH_P = 3.0
PITCH_D = 0.12
YAW_P = 1.5
YAW_D = 0.08
ATT_LIMIT = 45.0

STATE = {
    "integral_alt": 0.0,
    "last_alt": 0.0,
    "last_log_time": -10.0
}

def log(message):
    print(f"[auto] {message}")

def _clamp_collective(value):
    return clamp(value, COLLECTIVE_MIN, COLLECTIVE_MAX)

def automation_setup(ctx=None):
    log("Automation setup: clearing integrators and idling props")
    STATE["integral_alt"] = 0.0
    STATE["last_alt"] = float(get_abs_alt() or 0.0)
    STATE["last_log_time"] = -10.0
    for channel in props:
        channel.power(0)

def automation_reset(ctx=None):
    log("Session reset detected, reinitializing controller state")
    STATE["integral_alt"] = 0.0
    STATE["last_alt"] = float(get_abs_alt() or 0.0)
    STATE["last_log_time"] = -10.0
    for channel in props:
        channel.power(0)

def _timeline_time(ctx):
    if not ctx:
        return 0.0
    timeline = ctx.get("timeline") or {}
    return float(timeline.get("time", 0.0))

def automation_tick(ctx=None):
    dt = 0.016
    if ctx:
        dt = max(float(ctx.get("dt", dt)), 0.005)
    t = _timeline_time(ctx)
    altitude = float(get_abs_alt() or 0.0)
    error = TARGET_ALTITUDE - altitude

    if t < 0.5:
        STATE["integral_alt"] = 0.0

    STATE["integral_alt"] = clamp(
        STATE["integral_alt"] + error * dt,
        -ALT_I_LIMIT,
        ALT_I_LIMIT,
    )
    rate = 0.0
    if dt > 1e-3:
        rate = (altitude - STATE["last_alt"]) / dt
    STATE["last_alt"] = altitude

    collective_command = HOVER_ANALOG + ALT_KP * error + ALT_KI * STATE["integral_alt"] - ALT_KD * rate
    collective_command = _clamp_collective(collective_command)
    spool = clamp((t - SPINUP_DELAY) / SPINUP_RAMP, 0.0, 1.0)
    base = _clamp_collective(IDLE_POWER + spool * (collective_command - IDLE_POWER))

    attitude = get_estimated_attitude()
    imu = getIMUVal()
    gyro = imu.get("gyro", (0.0, 0.0, 0.0))
    gx = float(gyro[0]) * RAD_TO_DEG if len(gyro) >= 1 else 0.0
    gy = float(gyro[1]) * RAD_TO_DEG if len(gyro) >= 2 else 0.0
    gz = float(gyro[2]) * RAD_TO_DEG if len(gyro) >= 3 else 0.0

    roll_error = -float(attitude["roll_deg"])
    pitch_error = -float(attitude["pitch_deg"])
    yaw_error = -float(attitude["yaw_deg"])

    roll_term = clamp(ROLL_P * roll_error - ROLL_D * gx, -ATT_LIMIT, ATT_LIMIT)
    pitch_term = clamp(PITCH_P * pitch_error - PITCH_D * gy, -ATT_LIMIT, ATT_LIMIT)
    yaw_term = clamp(YAW_P * yaw_error - YAW_D * gz, -ATT_LIMIT, ATT_LIMIT)

    power1 = _clamp_collective(base + roll_term - pitch_term - yaw_term)
    power2 = _clamp_collective(base - roll_term - pitch_term + yaw_term)
    power3 = _clamp_collective(base - roll_term + pitch_term - yaw_term)
    power4 = _clamp_collective(base + roll_term + pitch_term + yaw_term)

    prop_1.power(power1)
    prop_2.power(power2)
    prop_3.power(power3)
    prop_4.power(power4)

    last_log = STATE.get("last_log_time", -10.0)
    if t - last_log >= 1.0:
        log(f"t={t:4.1f}s alt={altitude:5.2f}m err={error:+5.2f} power≈{base:6.1f}")
        STATE["last_log_time"] = t
`;

const rotorLabels = Array.from({ length: airframe.propulsion.rotorCount }, (_, i) => `Prop${i + 1}`);
const propAliasMap = new Map();
rotorLabels.forEach((label, index) => {
  const aliases = [
    label,
    label.toLowerCase(),
    `prop${index + 1}`,
    `prop_${index + 1}`,
    `prop ${index + 1}`,
    `motor${index + 1}`,
    `m${index + 1}`,
    `${index + 1}`
  ];
  aliases.forEach((alias) => propAliasMap.set(String(alias).toLowerCase(), index));
});

function buildPropPrelude() {
  const lines = [
    '# === Auto-generated prop helpers (created by the host app) ===',
    'class _PropChannel:',
    '    def __init__(self, identifier):',
    '        self._identifier = identifier',
    '    def power(self, value):',
    '        __prop_power(self._identifier, value)',
    '    def __repr__(self):',
    '        return f"<PropChannel {self._identifier}>"',
    ''
  ];

  const tupleNames = [];
  const propMapEntries = new Map();

  rotorLabels.forEach((label, index) => {
    const pyName = `prop_${index + 1}`;
    tupleNames.push(pyName);
    lines.push(`${pyName} = _PropChannel("${label}")`);
    lines.push(`prop${index + 1} = ${pyName}`);

    const aliasSet = new Set([
      label,
      label.toLowerCase(),
      `Prop${index + 1}`,
      `prop${index + 1}`,
      `prop_${index + 1}`,
      `prop ${index + 1}`,
      `motor${index + 1}`,
      `m${index + 1}`,
      `${index + 1}`
    ]);

    aliasSet.forEach((alias) => {
      propMapEntries.set(String(alias).toLowerCase(), pyName);
    });
  });

  lines.push(`props = (${tupleNames.join(', ')})`);
  lines.push('prop_map = {');
  propMapEntries.forEach((value, key) => {
    lines.push(`    "${key}": ${value},`);
  });
  lines.push('}');
  lines.push('');
  lines.push('# Quadrant reference:');
  lines.push('#   prop_1 -> 第一象限 (+X, +Y / 前右)');
  lines.push('#   prop_2 -> 第二象限 (-X, +Y / 前左)');
  lines.push('#   prop_3 -> 第三象限 (-X, -Y / 後左)');
  lines.push('#   prop_4 -> 第四象限 (+X, -Y / 後右)');
  lines.push('');
  lines.push('# Environment constants & helpers');
  lines.push(`ANALOG_MAX = ${ANALOG_MAX_POWER}`);
  lines.push(`MAX_RPM = ${MAX_RPM.toFixed(2)}`);
  lines.push(`HOVER_RPM = ${HOVER_RPM.toFixed(2)}`);
  lines.push(`HOVER_ANALOG = ${HOVER_ANALOG}`);
  lines.push(`FIELD_HEIGHT = ${FIELD_HEIGHT.toFixed(2)}`);
  lines.push(`ALTITUDE_BAND = (${ALTITUDE_SCORE_BAND.min.toFixed(2)}, ${ALTITUDE_SCORE_BAND.max.toFixed(2)})`);
  lines.push('RAD_TO_DEG = 57.29577951308232');
  lines.push('');
  lines.push('def clamp(value, minimum, maximum):');
  lines.push('    if value < minimum:');
  lines.push('        return minimum');
  lines.push('    if value > maximum:');
  lines.push('        return maximum');
  lines.push('    return value');
  lines.push('');
  lines.push('def get_abs_alt() -> float:');
  lines.push('    return __get_abs_alt()');
  lines.push('');
  lines.push('def getAbsAlt() -> float:');
  lines.push('    return __get_abs_alt()');
  lines.push('');
  lines.push('def get_altitude() -> float:');
  lines.push('    return __get_abs_alt()');
  lines.push('');
  lines.push('def get_tof_alt() -> float | None:');
  lines.push('    return __get_tof_alt()');
  lines.push('');
  lines.push('def getToFAlt() -> float | None:');
  lines.push('    return __get_tof_alt()');
  lines.push('');
  lines.push('def getIMUVal() -> dict:');
  lines.push('    return __get_imu()');
  lines.push('');
  lines.push('def get_imu() -> dict:');
  lines.push('    return __get_imu()');
  lines.push('');
  lines.push('def getMagVal() -> tuple:');
  lines.push('    return __get_mag()');
  lines.push('');
  lines.push('def get_mag() -> tuple:');
  lines.push('    return __get_mag()');
  lines.push('');
  lines.push('def get_estimated_attitude() -> dict:');
  lines.push('    return __get_estimated_attitude()');
  lines.push('');
  lines.push('def get_actual_attitude() -> dict:');
  lines.push('    return __get_actual_attitude()');
  lines.push('');
  lines.push('def get_timeline() -> dict:');
  lines.push('    return __get_timeline()');
  lines.push('');
  lines.push('def getTimeline() -> dict:');
  lines.push('    return __get_timeline()');
  lines.push('');
  lines.push('def get_hover_power() -> float:');
  lines.push('    return HOVER_ANALOG');
  lines.push('');
  lines.push('def getHoverPower() -> float:');
  lines.push('    return HOVER_ANALOG');
  lines.push('');
  lines.push('def get_hover_rpm() -> float:');
  lines.push('    return HOVER_RPM');
  lines.push('');
  lines.push('def getHoverRpm() -> float:');
  lines.push('    return HOVER_RPM');
  lines.push('');

  return lines.join('\n');
}

const app = document.getElementById('app') ?? document.body.appendChild(document.createElement('div'));
app.innerHTML = `
  <div class="app-shell">
    <header class="app-header">
      <h1 class="app-title">IMU Based Drone PID Demo <span class="badge">Beta</span></h1>
      <p class="app-subtitle">
        30秒ごとにリセットされるセッションで、IMU推定とPID制御を使ってJeNo3クアッドをホバリングさせるデモです。
        サイドバーのスライダーでセットポイントやPIDゲインを変更し、SkulptでPython製の自動操縦スクリプトも実行できます。
      </p>
    </header>
    <main class="app-main">
      <div class="layout">
        <section class="column">
          <article class="panel viewport-panel">
            <div class="timeline">
              <div class="timeline-header">
                <span>T0 = 0 s</span>
                <span>セッション #<span id="session-id">0</span></span>
              </div>
              <div class="timeline-bar">
                <div class="timeline-progress" id="timeline-progress"></div>
              </div>
              <div class="timeline-footer">
                <span>経過 <span id="timeline-elapsed">0.00 s</span></span>
                <span>残り <span id="timeline-remaining">30.00 s</span></span>
              </div>
              <div class="timeline-actions">
                <button class="secondary ghost" id="reset-world">Reset World</button>
              </div>
            </div>
            <div class="canvas-wrapper">
              <canvas id="hangar-canvas"></canvas>
              <div class="canvas-overlay">
                <span class="clock-chip" id="clock-chip">T +0.00 s</span>
                <span class="status-chip" id="status-chip">Grounded</span>
              </div>
            </div>
          </article>

          <article class="panel">
            <h2>Flight Metrics</h2>
            <div class="metrics-grid">
              <div class="metric-card">
                <h3>Actual attitude</h3>
                <strong id="attitude-actual">0° / 0° / 0°</strong>
              </div>
              <div class="metric-card">
                <h3>Estimated attitude</h3>
                <strong id="attitude-estimate">0° / 0° / 0°</strong>
              </div>
              <div class="metric-card">
                <h3>Altitude</h3>
                <strong id="altitude-display">0.00 m</strong>
              </div>
              <div class="metric-card" id="altitude-score-card">
                <h3>Altitude Score</h3>
                <strong id="altitude-score">0.0 pts</strong>
                <span class="metric-subtext" id="altitude-band-detail">0.00 s in band</span>
              </div>
              <div class="metric-card">
                <h3>Attitude error RMS</h3>
                <strong id="attitude-error">0.00 °</strong>
              </div>
            </div>
          </article>

          <article class="panel">
            <h2>Telemetry Charts</h2>
            <div class="chart-grid">
              <div class="chart-card">
                <h3>Altitude</h3>
                <canvas id="altitude-chart"></canvas>
              </div>
              <div class="chart-card">
                <h3>Altitude Score</h3>
                <canvas id="altitude-score-chart"></canvas>
              </div>
              <div class="chart-card">
                <h3>Attitude Score</h3>
                <canvas id="attitude-chart"></canvas>
              </div>
            </div>
          </article>
        </section>

        <aside class="column">
          <article class="panel">
            <h2>Setpoints</h2>
            <div class="control-group">
              <div class="control-block">
                <h3>姿勢ターゲット</h3>
                <div class="control-row">
                  <label for="roll-slider">Roll (°)</label>
                  <input type="range" id="roll-slider" min="-45" max="45" step="1" value="0" />
                  <span class="slider-value" id="roll-value">0°</span>
                </div>
                <div class="control-row">
                  <label for="pitch-slider">Pitch (°)</label>
                  <input type="range" id="pitch-slider" min="-45" max="45" step="1" value="0" />
                  <span class="slider-value" id="pitch-value">0°</span>
                </div>
                <div class="control-row">
                  <label for="yaw-slider">Yaw (°)</label>
                  <input type="range" id="yaw-slider" min="-90" max="90" step="1" value="0" />
                  <span class="slider-value" id="yaw-value">0°</span>
                </div>
              </div>

              <div class="control-block">
                <h3>推力</h3>
                <div class="control-row">
                  <label for="throttle-slider">Throttle</label>
                  <input type="range" id="throttle-slider" min="0" max="1" step="0.01" value="0" />
                  <span class="slider-value" id="throttle-value">0%</span>
                </div>
              </div>
            </div>
          </article>

          <article class="panel">
            <h2>PID Gains</h2>
            <div class="control-group">
              ${['roll', 'pitch', 'yaw']
                .map(
                  (axis) => `
                  <div class="control-block" data-axis="${axis}">
                    <h3>${axis.toUpperCase()}</h3>
                    <div class="control-row">
                      <label for="${axis}-kp">Kp</label>
                      <input type="range" id="${axis}-kp" min="0" max="10" step="0.1" value="${axis === 'yaw' ? 2 : 4}" />
                      <span class="slider-value" id="${axis}-kp-value"></span>
                    </div>
                    <div class="control-row">
                      <label for="${axis}-ki">Ki</label>
                      <input type="range" id="${axis}-ki" min="0" max="2" step="0.05" value="${axis === 'yaw' ? 0.3 : 0.5}" />
                      <span class="slider-value" id="${axis}-ki-value"></span>
                    </div>
                    <div class="control-row">
                      <label for="${axis}-kd">Kd</label>
                      <input type="range" id="${axis}-kd" min="0" max="4" step="0.1" value="${axis === 'yaw' ? 0.8 : 1.5}" />
                      <span class="slider-value" id="${axis}-kd-value"></span>
                    </div>
                  </div>
                `)
                .join('')}
            </div>
          </article>

          <article class="panel">
            <h2>Automation (Skulpt)</h2>
            <textarea id="python-editor" class="code-input" spellcheck="false"></textarea>
            <div class="button-row">
              <button class="primary" id="run-python">Run Python</button>
              <button class="secondary" id="clear-python">Clear</button>
              <button class="secondary" id="load-default">Load Default</button>
            </div>
            <div class="automation-status" id="automation-status">未実行</div>
            <div class="console-output" id="automation-console"></div>
            <div class="automation-status" id="automation-error"></div>
            <div class="footer-note">
              sleep()/hold()/at() で script_time を進め、prop_1.power(0-255) や updateRot(Prop1, 12000) で各ロータを操作できます。
              prop_1 は第一象限、None を渡すとオーバーライド解除です。
            </div>
          </article>
        </aside>
      </div>
    </main>
  </div>
`;

const dom = {
  session: document.getElementById('session-id'),
  progress: document.getElementById('timeline-progress'),
  elapsed: document.getElementById('timeline-elapsed'),
  remaining: document.getElementById('timeline-remaining'),
  clock: document.getElementById('clock-chip'),
  status: document.getElementById('status-chip'),
  attitudeActual: document.getElementById('attitude-actual'),
  attitudeEstimate: document.getElementById('attitude-estimate'),
  altitude: document.getElementById('altitude-display'),
  altitudeScore: document.getElementById('altitude-score'),
  altitudeBandDetail: document.getElementById('altitude-band-detail'),
  altitudeScoreCard: document.getElementById('altitude-score-card'),
  attitudeError: document.getElementById('attitude-error'),
  pythonEditor: document.getElementById('python-editor'),
  automationStatus: document.getElementById('automation-status'),
  automationConsole: document.getElementById('automation-console'),
  automationError: document.getElementById('automation-error'),
  throttleSlider: document.getElementById('throttle-slider'),
  throttleValue: document.getElementById('throttle-value'),
  runButton: document.getElementById('run-python'),
  clearButton: document.getElementById('clear-python'),
  loadDefaultButton: document.getElementById('load-default'),
  resetWorldButton: document.getElementById('reset-world')
};

dom.pythonEditor.value = defaultPython;

dom.throttleValue.textContent = '0%';

const sliderEls = {
  roll: document.getElementById('roll-slider'),
  pitch: document.getElementById('pitch-slider'),
  yaw: document.getElementById('yaw-slider')
};

const sliderValues = {
  roll: document.getElementById('roll-value'),
  pitch: document.getElementById('pitch-value'),
  yaw: document.getElementById('yaw-value')
};

const pidSliders = ['roll', 'pitch', 'yaw'].reduce((acc, axis) => {
  acc[axis] = {
    kp: document.getElementById(`${axis}-kp`),
    ki: document.getElementById(`${axis}-ki`),
    kd: document.getElementById(`${axis}-kd`),
    labels: {
      kp: document.getElementById(`${axis}-kp-value`),
      ki: document.getElementById(`${axis}-ki-value`),
      kd: document.getElementById(`${axis}-kd-value`)
    }
  };
  return acc;
}, {});

const setpointState = {
  roll: 0,
  pitch: 0,
  yaw: 0,
  throttle: 0
};

const pidState = {
  roll: { kp: 4.0, ki: 0.5, kd: 1.5 },
  pitch: { kp: 4.0, ki: 0.5, kd: 1.5 },
  yaw: { kp: 2.0, ki: 0.3, kd: 0.8 }
};

function updateSetpointLabels() {
  sliderValues.roll.textContent = `${setpointState.roll.toFixed(0)}°`;
  sliderValues.pitch.textContent = `${setpointState.pitch.toFixed(0)}°`;
  sliderValues.yaw.textContent = `${setpointState.yaw.toFixed(0)}°`;
  dom.throttleValue.textContent = `${Math.round(setpointState.throttle * 100)}%`;
}

updateSetpointLabels();

['roll', 'pitch', 'yaw'].forEach((axis) => {
  sliderEls[axis].addEventListener('input', () => {
    setpointState[axis] = Number(sliderEls[axis].value);
    updateSetpointLabels();
    sendSetpoint();
  });
});

dom.throttleSlider.addEventListener('input', () => {
  setpointState.throttle = Number(dom.throttleSlider.value);
  updateSetpointLabels();
  sendSetpoint();
});

['roll', 'pitch', 'yaw'].forEach((axis) => {
  const sliders = pidSliders[axis];
  if (!sliders) return;
  ['kp', 'ki', 'kd'].forEach((key) => {
    const slider = sliders[key];
    const label = sliders.labels[key];
    const precision = key === 'ki' ? 2 : 1;
    if (slider) {
      slider.value = String(pidState[axis][key]);
      label.textContent = pidState[axis][key].toFixed(precision);
      slider.addEventListener('input', () => {
        const value = Number(slider.value);
        pidState[axis][key] = value;
        label.textContent = value.toFixed(precision);
        updatePid(axis);
      });
    }
  });
});

const canvas = document.getElementById('hangar-canvas');
const viewport = createHangarViewport(canvas);
const altitudeChart = createHistoryChart(document.getElementById('altitude-chart'), {
  range: [0, FIELD_HEIGHT],
  color: '#22d3ee',
  timeWindow: timelineDuration
});
const altitudeScoreChart = createHistoryChart(document.getElementById('altitude-score-chart'), {
  range: [0, 100],
  color: '#34d399',
  timeWindow: timelineDuration
});
const attitudeChart = createHistoryChart(document.getElementById('attitude-chart'), {
  range: [0, 100],
  color: '#fbbf24',
  timeWindow: timelineDuration
});

let workerReady = false;
let timeline = { time: 0, duration: timelineDuration, sessionId: 0, absolute: 0 };
let latestSnapshot = null;
let latestEstimation = null;
let latestMeasurement = null;
let latestScores = null;
let lastAutomationCommand = null;
let autopConsole = '';
let autopError = '';
let autopStatus = '未実行';
let defaultAutomationArmed = true;
let defaultAutomationLaunched = false;

const autopilot = {
  schedule: [],
  pointer: 0,
  lastSessionId: 0,
  active: false,
  rotorOverrides: {},
  rotorOverrideMap: null,
  lastRotorOverrideHash: '',
  python: null,
  loop: true
};

dom.runButton.addEventListener('click', () => {
  runAutomation();
});

dom.clearButton.addEventListener('click', () => {
  clearAutomation();
});

dom.loadDefaultButton.addEventListener('click', () => {
  dom.pythonEditor.value = defaultPython;
  autopStatus = 'デフォルトスクリプトを読み込みました。';
  updateAutomationDisplays();
  defaultAutomationArmed = true;
});

function updateAutomationDisplays() {
  dom.automationStatus.textContent = autopStatus;
  dom.automationConsole.textContent = autopConsole.trim() ? autopConsole : 'Skulpt 標準出力なし';
  dom.automationConsole.scrollTop = dom.automationConsole.scrollHeight;
  dom.automationError.textContent = autopError;
}

function builtinRead(x) {
  if (!Sk.builtinFiles || !Sk.builtinFiles['files'][x]) {
    throw new Error(`File not found: ${x}`);
  }
  return Sk.builtinFiles['files'][x];
}

function resolvePropIdentifier(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  return propAliasMap.has(normalized) ? propAliasMap.get(normalized) : null;
}

function formatPropLabel(index) {
  return rotorLabels[index] ?? `Prop${index + 1}`;
}

function computeDisplayAltitude(rawAltitude = 0) {
  const offset = typeof viewport.getFrameGroundOffset === 'function' ? viewport.getFrameGroundOffset() : 0;
  const clamped = Math.min(FIELD_HEIGHT, Math.max(0, rawAltitude));
  return clamped + offset;
}

function sendSetpoint() {
  if (!workerReady) return;
  worker.postMessage({
    type: 'setpoint',
    roll: setpointState.roll,
    pitch: setpointState.pitch,
    yaw: setpointState.yaw,
    throttle: setpointState.throttle
  });
}

function updatePid(axis) {
  if (!pidState[axis]) return;
  worker.postMessage({ type: 'pid', axis, gains: pidState[axis] });
}

function sendRotorOverrides(overrides = {}, replace = false) {
  worker.postMessage({ type: 'rotorOverrides', overrides, replace });
}

function appendAutomationOutput(text, { immediate = true } = {}) {
  if (!text) return;
  autopConsole = `${autopConsole}${text}`;
  const limit = 8000;
  if (autopConsole.length > limit) {
    autopConsole = autopConsole.slice(autopConsole.length - limit);
  }
  if (immediate) {
    updateAutomationDisplays();
  }
}

function syncRotorOverridesFromMap({ force = false } = {}) {
  const map = autopilot.python?.rotorOverrideMap ?? autopilot.rotorOverrideMap;
  if (!map) return;
  const overrides = {};
  map.forEach((value, index) => {
    overrides[index] = value;
  });
  const serialized = JSON.stringify(overrides);
  if (autopilot.python) {
    if (!force && autopilot.python.lastOverrideHash === serialized) {
      return;
    }
    autopilot.python.lastOverrideHash = serialized;
  } else {
    if (!force && autopilot.lastRotorOverrideHash === serialized) {
      return;
    }
    autopilot.lastRotorOverrideHash = serialized;
  }
  autopilot.rotorOverrides = overrides;
  sendRotorOverrides(overrides, true);
}

function buildAutomationContext({ dt = 0, reason = 'tick' } = {}) {
  const timelineState = timeline ?? {};
  const duration = Number(timelineState.duration ?? timelineDuration);
  const time = Number(timelineState.time ?? 0);
  const remaining = Math.max(0, duration - time);
  const absolute = Number(timelineState.absolute ?? time);

  const measurement = latestMeasurement ?? {};
  const estimation = latestEstimation ?? {};
  const snapshot = latestSnapshot ?? {};
  const sensors = {
    abs_altitude: measurement.absAltitude ?? snapshot.state?.position?.[2] ?? 0,
    tof_altitude: measurement.tof ?? measurement.tofAltitude ?? null,
    imu: {
      gyro: Array.isArray(measurement.gyro) ? [...measurement.gyro] : [0, 0, 0],
      acc: Array.isArray(measurement.acc) ? [...measurement.acc] : [0, 0, 0],
      mag: Array.isArray(measurement.mag) ? [...measurement.mag] : [0, 0, 0]
    }
  };

  return {
    reason,
    dt,
    timeline: {
      time,
      duration,
      remaining,
      absolute,
      session: Number(timelineState.sessionId ?? 0)
    },
    sensors,
    estimation: {
      roll: estimation.roll ?? 0,
      pitch: estimation.pitch ?? 0,
      yaw: estimation.yaw ?? 0,
      roll_deg: radiansToDegrees(estimation.roll ?? 0),
      pitch_deg: radiansToDegrees(estimation.pitch ?? 0),
      yaw_deg: radiansToDegrees(estimation.yaw ?? 0),
      quaternion: estimation.quaternion ?? snapshot.state?.quaternion ?? [0, 0, 0, 1]
    },
    actual: {
      roll_deg: snapshot.state?.eulerDeg?.roll ?? 0,
      pitch_deg: snapshot.state?.eulerDeg?.pitch ?? 0,
      yaw_deg: snapshot.state?.eulerDeg?.yaw ?? 0,
      quaternion: snapshot.state?.quaternion ?? [0, 0, 0, 1],
      position: snapshot.state?.position ?? [0, 0, 0]
    },
    scores: latestScores ?? {},
    hover: {
      analog: HOVER_ANALOG,
      rpm: HOVER_RPM,
      maxAnalog: ANALOG_MAX_POWER,
      maxRpm: MAX_RPM
    },
    altitude_band: ALTITUDE_SCORE_BAND,
    field_height: FIELD_HEIGHT
  };
}

async function safeCallPython(func, args = [], { hookName = 'call', disableOnError = true } = {}) {
  if (!func || typeof func.tp$call !== 'function') return null;
  const pyArgs = args.map((arg) => Sk.ffi.remapToPy(arg));
  try {
    const result = await Sk.misceval.asyncToPromise(() => Sk.misceval.callsimOrSuspend(func, ...pyArgs));
    autopError = '';
    return result;
  } catch (error) {
    const message = error?.toString?.() ?? 'Unknown error';
    autopError = message;
    autopStatus = `Python ${hookName} でエラー`;
    appendAutomationOutput(`${message}\n`);
    console.error('[automation] Python error in', hookName, error);
    if (disableOnError) {
      autopilot.python = null;
      autopilot.rotorOverrideMap = null;
      autopilot.rotorOverrides = {};
      autopilot.lastRotorOverrideHash = '';
      sendRotorOverrides({}, true);
    }
    updateAutomationDisplays();
    return null;
  }
}

async function runPythonAutomationTick() {
  const python = autopilot.python;
  if (!python || !python.tick) return;
  if (python.busy) return;
  python.busy = true;
  try {
    if (python.needsReset && python.reset) {
      python.needsReset = false;
      await safeCallPython(python.reset, [buildAutomationContext({ dt: 0, reason: 'reset' })], {
        hookName: 'automation_reset'
      });
    }

    const timeNow = timeline?.time ?? 0;
    const dt = python.lastTimelineTime !== undefined ? Math.max(0, timeNow - python.lastTimelineTime) : 0;
    python.lastTimelineTime = timeNow;

    const result = await safeCallPython(python.tick, [buildAutomationContext({ dt, reason: 'tick' })], {
      hookName: 'automation_tick'
    });

    if (result !== null && autopilot.python === python) {
      syncRotorOverridesFromMap();
      const shouldUpdateStatus =
        python.lastStatusUpdate === undefined || Math.abs(timeNow - python.lastStatusUpdate) >= 0.25;
      if (shouldUpdateStatus) {
        autopStatus = `Python制御 t=${timeNow.toFixed(2)} s`;
        python.lastStatusUpdate = timeNow;
        updateAutomationDisplays();
      }
    }
  } finally {
    python.busy = false;
  }
}

async function runAutomation({ fromAuto = false } = {}) {
  if (!fromAuto) {
    defaultAutomationArmed = false;
  }
  autopConsole = '';
  autopError = '';
  autopStatus = 'Skulptで解析中…';
  updateAutomationDisplays();

  const queue = [];
  const rotorOverrideMap = new Map();
  autopilot.rotorOverrideMap = rotorOverrideMap;

  if (!fromAuto) {
    autopilot.python = null;
  }

  const toPyAttitude = (attitude = {}) => {
    const rollRad = Number(attitude.roll ?? attitude.roll_rad ?? 0);
    const pitchRad = Number(attitude.pitch ?? attitude.pitch_rad ?? 0);
    const yawRad = Number(attitude.yaw ?? attitude.yaw_rad ?? 0);
    const dict = new Sk.builtin.dict([]);
    dict.mp$ass_subscript(new Sk.builtin.str('roll_rad'), new Sk.builtin.float_(rollRad));
    dict.mp$ass_subscript(new Sk.builtin.str('pitch_rad'), new Sk.builtin.float_(pitchRad));
    dict.mp$ass_subscript(new Sk.builtin.str('yaw_rad'), new Sk.builtin.float_(yawRad));
    dict.mp$ass_subscript(new Sk.builtin.str('roll_deg'), new Sk.builtin.float_(radiansToDegrees(rollRad)));
    dict.mp$ass_subscript(new Sk.builtin.str('pitch_deg'), new Sk.builtin.float_(radiansToDegrees(pitchRad)));
    dict.mp$ass_subscript(new Sk.builtin.str('yaw_deg'), new Sk.builtin.float_(radiansToDegrees(yawRad)));
    return dict;
  };

  function applyRotorOverride(index, rpmValue, { source = 'prop.power', annotation } = {}) {
    const label = formatPropLabel(index);
    if (rpmValue === null || rpmValue === undefined) {
      rotorOverrideMap.set(index, null);
      const shouldLog = !autopilot.python || !autopilot.python.tick;
      if (shouldLog) {
        let line = `${source}: ${label} オーバーライド解除`;
        if (annotation) line += ` ${annotation}`;
        appendAutomationOutput(`${line}\n`);
      }
      return null;
    }

    const rpmNumber = Number(rpmValue);
    if (!Number.isFinite(rpmNumber)) {
      throw new Sk.builtin.ValueError(`${source}: RPM には有限の数値を指定してください`);
    }

    const clamped = Math.max(0, Math.min(rpmNumber, MAX_RPM));
    const previous = rotorOverrideMap.get(index);
    rotorOverrideMap.set(index, clamped);

    const shouldLog =
      !autopilot.python || !autopilot.python.tick || previous === undefined || previous === null;

    if (shouldLog) {
      let line = `${source}: ${label} → ${clamped.toFixed(0)} rpm`;
      if (annotation) line += ` ${annotation}`;
      if (clamped !== rpmNumber) {
        line += ` (入力 ${rpmNumber.toFixed(0)} rpm をクランプ)`;
      }
      appendAutomationOutput(`${line}\n`);
    }

    return clamped;
  }

  Sk.configure({
    output: (text) => appendAutomationOutput(text),
    read: builtinRead,
    __future__: Sk.python3,
    execLimit: 10000
  });

  Sk.sysmodules = new Sk.builtin.dict([]);
  rotorLabels.forEach((label, index) => {
    Sk.builtins[`Prop${index + 1}`] = new Sk.builtin.str(label);
  });

  const altitudeBuiltin = new Sk.builtin.func(function () {
    const measurement = latestMeasurement ?? {};
    const snapshot = latestSnapshot ?? {};
    const rawAltitude =
      measurement.absAltitude ??
      measurement.altitude ??
      snapshot.state?.position?.[2] ??
      0;
    const clamped = Math.max(0, Math.min(Number(rawAltitude) || 0, FIELD_HEIGHT));
    return new Sk.builtin.float_(clamped);
  });
  Sk.builtins.__get_abs_alt = altitudeBuiltin;
  Sk.builtins.__get_altitude = altitudeBuiltin;
  Sk.builtins.getAbsAlt = altitudeBuiltin;
  Sk.builtins.get_altitude = altitudeBuiltin;

  Sk.builtins.__get_actual_attitude = new Sk.builtin.func(function () {
    const snapshot = latestSnapshot ?? {};
    const euler = snapshot.state?.euler ?? { roll: 0, pitch: 0, yaw: 0 };
    return toPyAttitude(euler);
  });

  Sk.builtins.__get_estimated_attitude = new Sk.builtin.func(function () {
    const estimation = latestEstimation ?? {};
    return toPyAttitude(estimation);
  });

  const timelineBuiltin = new Sk.builtin.func(function () {
    const state = timeline ?? {};
    const duration = Number(state.duration ?? timelineDuration);
    const time = Number(state.time ?? 0);
    const remaining = Math.max(0, duration - time);
    const absolute = Number(state.absolute ?? time);
    return Sk.ffi.remapToPy({
      time,
      duration,
      remaining,
      absolute,
      session: Number(state.sessionId ?? 0)
    });
  });
  Sk.builtins.__get_timeline = timelineBuiltin;
  Sk.builtins.get_timeline = timelineBuiltin;
  Sk.builtins.getTimeline = timelineBuiltin;

  const tofBuiltin = new Sk.builtin.func(function () {
    const measurement = latestMeasurement ?? {};
    const tof = measurement.tof ?? measurement.tofAltitude;
    if (tof === null || tof === undefined) {
      return Sk.builtin.none.none$;
    }
    const value = Math.max(0, Math.min(Number(tof) || 0, FIELD_HEIGHT * 1.2));
    return new Sk.builtin.float_(value);
  });
  Sk.builtins.__get_tof_alt = tofBuiltin;
  Sk.builtins.getToFAlt = tofBuiltin;
  Sk.builtins.get_tof_alt = tofBuiltin;

  const imuBuiltin = new Sk.builtin.func(function () {
    const measurement = latestMeasurement ?? {};
    const gyro = Array.isArray(measurement.gyro) ? measurement.gyro.map((v) => Number(v) || 0) : [0, 0, 0];
    const acc = Array.isArray(measurement.acc) ? measurement.acc.map((v) => Number(v) || 0) : [0, 0, 0];
    return Sk.ffi.remapToPy({ gyro, acc });
  });
  Sk.builtins.__get_imu = imuBuiltin;
  Sk.builtins.getIMUVal = imuBuiltin;
  Sk.builtins.get_imu = imuBuiltin;

  const magBuiltin = new Sk.builtin.func(function () {
    const measurement = latestMeasurement ?? {};
    const mag = Array.isArray(measurement.mag) ? measurement.mag.map((v) => Number(v) || 0) : [0, 0, 0];
    return Sk.ffi.remapToPy(mag);
  });
  Sk.builtins.__get_mag = magBuiltin;
  Sk.builtins.getMagVal = magBuiltin;
  Sk.builtins.get_mag = magBuiltin;

  Sk.builtins.command = new Sk.builtin.func(function () {
    throw new Sk.builtin.RuntimeError('command() は無効化されています。prop.power() を使用してください。');
  });

  Sk.builtins.updateRot = new Sk.builtin.func(function () {
    throw new Sk.builtin.RuntimeError('updateRot() は無効化されています。prop.power() を使用してください。');
  });

  Sk.builtins.__prop_power = new Sk.builtin.func(function (prop, power) {
    if (prop === undefined) {
      throw new Sk.builtin.ValueError('prop.power(): プロペラ識別子が必要です');
    }
    const identifier = Sk.ffi.remapToJs(prop);
    const index = resolvePropIdentifier(identifier);
    if (index === null) {
      throw new Sk.builtin.ValueError('prop.power(): prop_1〜prop_4 など既知の識別子で指定してください');
    }
    if (power === undefined) {
      throw new Sk.builtin.ValueError('prop.power(value): value には 0〜255 の数値を指定してください');
    }
    const analogJs = Sk.ffi.remapToJs(power);
    if (analogJs === null) {
      applyRotorOverride(index, null, { source: 'prop.power' });
      return Sk.builtin.none.none$;
    }
    const analogNumber = Number(analogJs);
    if (!Number.isFinite(analogNumber)) {
      throw new Sk.builtin.ValueError('prop.power(): 0〜255 の数値を指定してください');
    }
    const clampedAnalog = Math.max(0, Math.min(analogNumber, ANALOG_MAX_POWER));
    const rpmTarget = (clampedAnalog / ANALOG_MAX_POWER) * MAX_RPM;
    let annotation = `(analog ${clampedAnalog.toFixed(0)}/${ANALOG_MAX_POWER})`;
    if (clampedAnalog !== analogNumber) {
      annotation += ` 入力 ${analogNumber.toFixed(0)} をクランプ`;
    }
    applyRotorOverride(index, rpmTarget, { source: 'prop.power', annotation });
    return Sk.builtin.none.none$;
  });

  try {
    const scriptBody = `${buildPropPrelude()}\n${dom.pythonEditor.value}`;
    const module = await Sk.misceval.asyncToPromise(() =>
      Sk.importMainWithBody('<stdin>', false, scriptBody, true)
    );

    queue.sort((a, b) => a.time - b.time);
    autopilot.schedule = queue;
    autopilot.pointer = 0;
    autopilot.lastSessionId = timeline.sessionId;
    autopilot.active = queue.length > 0;

    const overrides = {};
    rotorOverrideMap.forEach((value, index) => {
      overrides[index] = value;
    });
    autopilot.rotorOverrides = overrides;
    autopilot.lastRotorOverrideHash = JSON.stringify(overrides);

    const overrideCount = Object.values(overrides).filter(
      (value) => value !== undefined && value !== null
    ).length;

    const getAttr = (name) => {
      try {
        const attr = Sk.abstr.gattr(module, name, false);
        return attr && typeof attr.tp$call === 'function' ? attr : null;
      } catch (err) {
        return null;
      }
    };

    const pythonControllerCandidate = {
      module,
      tick: getAttr('automation_tick'),
      setup: getAttr('automation_setup'),
      reset: getAttr('automation_reset'),
      rotorOverrideMap,
      lastOverrideHash: '',
      busy: false,
      needsReset: false,
      lastTimelineTime: timeline?.time ?? 0,
      lastStatusUpdate: undefined
    };

    const hasPythonHooks =
      pythonControllerCandidate.tick ||
      pythonControllerCandidate.setup ||
      pythonControllerCandidate.reset;

    autopilot.python = hasPythonHooks ? pythonControllerCandidate : null;

    const summary = [];
    if (queue.length) summary.push(`コマンド ${queue.length} 件`);
    if (overrideCount) summary.push(`プロペラ更新 ${overrideCount} 件`);
    if (autopilot.python?.tick) summary.push('Python tick 有効');

    autopStatus = summary.length ? `${summary.join(' / ')}を読み込みました。` : 'Pythonスクリプトを読み込みました。';
    updateAutomationDisplays();

    if (autopilot.python) {
      await safeCallPython(autopilot.python.setup, [buildAutomationContext({ dt: 0, reason: 'setup' })], {
        hookName: 'automation_setup',
        disableOnError: true
      });
      syncRotorOverridesFromMap({ force: true });
    } else {
      syncRotorOverridesFromMap({ force: true });
    }

    if (!queue.length && !overrideCount && !(autopilot.python && autopilot.python.tick)) {
      appendAutomationOutput('⚠️ prop.power() を使った自動制御が検出できませんでした。\n');
    }

    lastAutomationCommand = null;
    applyAutomation();
  } catch (error) {
    autopilot.schedule = [];
    autopilot.pointer = 0;
    autopilot.active = false;
    autopilot.python = null;
    autopilot.rotorOverrideMap = null;
    autopilot.rotorOverrides = {};
    autopilot.lastRotorOverrideHash = '';
    autopStatus = '自動制御プログラムの解析に失敗しました。';
    autopError = error.toString();
    updateAutomationDisplays();
    console.error('[automation] Skulpt execution failed', error);
  }
}

function clearAutomation() {
  autopilot.schedule = [];
  autopilot.pointer = 0;
  autopilot.lastSessionId = timeline.sessionId;
  autopilot.active = false;
  autopilot.rotorOverrides = {};
  autopilot.rotorOverrideMap = null;
  autopilot.lastRotorOverrideHash = '';
  autopilot.python = null;
  autopConsole = '';
  autopError = '';
  autopStatus = '自動制御をリセットしました。';
  defaultAutomationArmed = false;
  defaultAutomationLaunched = false;
  updateAutomationDisplays();
  sendRotorOverrides({}, true);
}

function applyAutomationCommand(command) {
  let changed = false;
  if (command.roll !== undefined) {
    setpointState.roll = clamp(Number(command.roll), -90, 90);
    sliderEls.roll.value = String(setpointState.roll);
    changed = true;
  }
  if (command.pitch !== undefined) {
    setpointState.pitch = clamp(Number(command.pitch), -90, 90);
    sliderEls.pitch.value = String(setpointState.pitch);
    changed = true;
  }
  if (command.yaw !== undefined) {
    setpointState.yaw = clamp(Number(command.yaw), -180, 180);
    sliderEls.yaw.value = String(setpointState.yaw);
    changed = true;
  }
  if (command.throttle !== undefined) {
    setpointState.throttle = clamp(Number(command.throttle), 0, 1);
    dom.throttleSlider.value = String(setpointState.throttle);
    changed = true;
  }
  if (changed) {
    updateSetpointLabels();
    sendSetpoint();
    autopStatus = `t=${command.time.toFixed(2)} s でコマンド適用`;
    updateAutomationDisplays();
  }
}

function applyAutomation() {
  if (!autopilot.active || !timeline) return;
  if (autopilot.lastSessionId !== timeline.sessionId) {
    if (autopilot.loop) {
      autopilot.pointer = 0;
      autopilot.lastSessionId = timeline.sessionId;
      lastAutomationCommand = null;
    } else {
      autopilot.active = false;
      autopStatus = '自動制御は1セッションで停止します。';
      updateAutomationDisplays();
      return;
    }
  }

  while (autopilot.pointer < autopilot.schedule.length && autopilot.schedule[autopilot.pointer].time <= timeline.time + 1e-4) {
    const command = autopilot.schedule[autopilot.pointer];
    applyAutomationCommand(command);
    autopilot.pointer += 1;
    autopilot.lastSessionId = timeline.sessionId;
    lastAutomationCommand = command;
  }
}

function handleSessionReset() {
  altitudeChart.clear();
  altitudeScoreChart.clear();
  attitudeChart.clear();
  latestMeasurement = null;
  if (autopilot.python) {
    autopilot.python.needsReset = true;
    autopilot.python.lastTimelineTime = timeline?.time ?? 0;
  }
  if (Object.keys(autopilot.rotorOverrides || {}).length) {
    sendRotorOverrides(autopilot.rotorOverrides, true);
  }
  if (!autopilot.schedule.length) return;
  if (autopilot.loop) {
    autopilot.pointer = 0;
    autopilot.lastSessionId = timeline.sessionId;
    lastAutomationCommand = null;
    autopStatus = 'セッションがリセットしました。自動プログラムを再実行します。';
  } else {
    autopilot.active = false;
    autopStatus = 'セッションがリセットしたため自動制御を停止しました。';
  }
  updateAutomationDisplays();
}

const worker = new Worker(new URL('./worker/simWorker.js', import.meta.url), { type: 'module' });

dom.resetWorldButton.addEventListener('click', () => {
  autopStatus = '世界のリセットを要求しました…';
  updateAutomationDisplays();
  worker.postMessage({ type: 'resetWorld' });
});

worker.onmessage = (event) => {
  const data = event.data;
  if (!data || data.type !== 'state') return;
  const snapshot = data.snapshot ?? latestSnapshot;
  if (!snapshot) return;
  latestSnapshot = snapshot;
  latestEstimation = data.estimation ?? latestEstimation;
  latestMeasurement = data.measurement ?? latestMeasurement;
  timeline = snapshot.timeline ?? data.timeline ?? timeline;

  dom.session.textContent = String(timeline.sessionId ?? 0);
  dom.elapsed.textContent = `${(timeline.time ?? 0).toFixed(2)} s`;
  const remaining = Math.max(0, (timeline.duration ?? timelineDuration) - (timeline.time ?? 0));
  dom.remaining.textContent = `${remaining.toFixed(2)} s`;
  const progressRatio = Math.min(1, Math.max(0, (timeline.time ?? 0) / (timeline.duration || timelineDuration)));
  dom.progress.style.width = `${(progressRatio * 100).toFixed(1)}%`;
  dom.clock.textContent = `T +${(timeline.time ?? 0).toFixed(2)} s`;

  const attitudeDeg = snapshot.state?.eulerDeg ?? { roll: 0, pitch: 0, yaw: 0 };
  dom.attitudeActual.textContent = `${attitudeDeg.roll.toFixed(1)}° / ${attitudeDeg.pitch.toFixed(1)}° / ${attitudeDeg.yaw.toFixed(1)}°`;

  const est = latestEstimation
    ? {
        roll: radiansToDegrees(latestEstimation.roll),
        pitch: radiansToDegrees(latestEstimation.pitch),
        yaw: radiansToDegrees(latestEstimation.yaw)
      }
    : { roll: 0, pitch: 0, yaw: 0 };
  dom.attitudeEstimate.textContent = `${est.roll.toFixed(1)}° / ${est.pitch.toFixed(1)}° / ${est.yaw.toFixed(1)}°`;

  const altitudeRaw = snapshot.state?.position?.[2] ?? 0;
  const altitudeDisplay = computeDisplayAltitude(altitudeRaw);
  dom.altitude.textContent = `${altitudeDisplay.toFixed(2)} m`;
  dom.status.textContent = altitudeRaw > 0.05 ? 'In flight' : 'Grounded';

  latestScores = data.scores ?? snapshot.scores ?? latestScores;
  const altitudeScoreInfo = (latestScores ?? {}).altitude ?? {};
  const altitudeScoreValue = Number(altitudeScoreInfo.score ?? 0);
  const altitudeTimeInBand = Number(altitudeScoreInfo.timeInBand ?? 0);
  const bandMin = Number(altitudeScoreInfo.band?.min ?? ALTITUDE_SCORE_BAND.min);
  const bandMax = Number(altitudeScoreInfo.band?.max ?? ALTITUDE_SCORE_BAND.max);
  if (dom.altitudeScore) {
    dom.altitudeScore.textContent = `${altitudeScoreValue.toFixed(1)} pts`;
  }
  if (dom.altitudeBandDetail) {
    dom.altitudeBandDetail.textContent = `${altitudeTimeInBand.toFixed(2)} s in ${bandMin.toFixed(1)}–${bandMax.toFixed(1)} m`;
  }
  if (dom.altitudeScoreCard) {
    dom.altitudeScoreCard.title = `Field height ${FIELD_HEIGHT.toFixed(1)} m / corridor ${bandMin.toFixed(1)}–${bandMax.toFixed(1)} m`;
  }

  const errorsRad = data.errors ?? { roll: 0, pitch: 0, yaw: 0 };
  const errorsDeg = {
    roll: radiansToDegrees(errorsRad.roll ?? 0),
    pitch: radiansToDegrees(errorsRad.pitch ?? 0),
    yaw: radiansToDegrees(errorsRad.yaw ?? 0)
  };
  const rms = Math.sqrt((errorsDeg.roll ** 2 + errorsDeg.pitch ** 2 + errorsDeg.yaw ** 2) / 3);
  dom.attitudeError.textContent = `${rms.toFixed(2)} °`;
  const attitudeScore = Math.max(0, Math.min(100, 100 - rms * 8));

  altitudeChart.push({ time: timeline.time ?? 0, value: altitudeDisplay });
  altitudeScoreChart.push({ time: timeline.time ?? 0, value: altitudeScoreValue });
  attitudeChart.push({ time: timeline.time ?? 0, value: attitudeScore });

  viewport.update({
    actualQuaternion: snapshot.state?.quaternion,
    estimatedQuaternion: latestEstimation?.quaternion ?? snapshot.state?.quaternion,
    position: snapshot.state?.position
  });

  if (data.sessionReset) {
    handleSessionReset();
  }

  workerReady = true;
  applyAutomation();
  void runPythonAutomationTick();

  if (defaultAutomationArmed && !defaultAutomationLaunched) {
    defaultAutomationLaunched = true;
    runAutomation({ fromAuto: true });
  }
};

worker.postMessage({
  type: 'init',
  dt: 0.005,
  filterAlpha: 0.06,
  publishRate: 60,
  pid: pidState,
  sessionDuration: timelineDuration
});

window.addEventListener('beforeunload', () => {
  viewport.dispose();
  worker.terminate();
});

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[sw] Service workers are not supported in this browser');
    return;
  }

  const register = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js');
      console.log('[sw] Registered service worker', registration);
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          console.log('[sw] Installing worker state', installing.state);
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[sw] Controller changed');
      });
    } catch (error) {
      console.error('[sw] Failed to register service worker', error);
    }
  };

  if (document.readyState === 'complete') {
    void register();
  } else {
    window.addEventListener('load', () => void register(), { once: true });
  }
}

registerServiceWorker();
