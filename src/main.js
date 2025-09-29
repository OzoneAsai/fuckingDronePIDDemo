import Sk from 'skulpt';
import './app.css';
import { createHangarViewport } from './viewport.js';
import { createHistoryChart } from './charts.js';
import { airframe } from './lib/airframeData.js';
import { propulsionLimits } from './lib/propulsion.js';
import { radiansToDegrees, clamp } from './lib/math.js';

const timelineDuration = 30;
const defaultPython = `# === Automation bootstrap ===
# prop_1 は第一象限 (カメラを上にしたときに前右) のロータです。
# prop_2, prop_3, prop_4 は反時計回りに配置されています。
#
# 付属のヘルパー:
#   - sleep(seconds): タイムラインを seconds 進めます。
#   - hold(throttle, roll, pitch, yaw): 現在の script_time でコマンドを登録します。
#   - at(time_s, ...): script_time を time_s に移動してコマンドを登録します。
#   - get_altitude(): 現在の高度 [m]。
#   - get_estimated_attitude(): 推定姿勢 (deg/rad) の dict。
#   - get_actual_attitude(): 実姿勢 (deg/rad) の dict。
def log(message):
    print(f"[auto] {message}")

def spin_props(power):
    prop_1.power(power)
    prop_2.power(power)
    prop_3.power(power)
    prop_4.power(power)

def getError():
    est = get_estimated_attitude()
    act = get_actual_attitude()
    return {
        "roll_deg": act["roll_deg"] - est["roll_deg"],
        "pitch_deg": act["pitch_deg"] - est["pitch_deg"],
        "yaw_deg": act["yaw_deg"] - est["yaw_deg"],
    }

def stabilize(kp=4.0, ki=0.5, kd=1.5):
    log("Stabilize around hover throttle")
    hold(throttle=0.50, roll=0.0, pitch=0.0, yaw=0.0)
    sleep(2.5)
    hold(throttle=0.48, roll=0.0, pitch=0.0, yaw=0.0)
    sleep(2.0)

def liftOff():
    log("Spooling props for liftoff")
    spin_props(255)
    sleep(0.8)
    hold(throttle=0.55, roll=0.0, pitch=0.0, yaw=0.0)
    sleep(3.2)
    if get_altitude() >= 0.6:
        stabilize()
    log("Preparing to land")
    hold(throttle=0.44, roll=0.0, pitch=0.0, yaw=0.0)
    sleep(2.0)
    hold(throttle=0.30, roll=0.0, pitch=0.0, yaw=0.0)
    sleep(1.2)
    log("Cutting motors")
    spin_props(0)
    hold(throttle=0.0, roll=0.0, pitch=0.0, yaw=0.0)

liftOff()
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

const ANALOG_MAX_POWER = 255;

function buildPropPrelude() {
  const lines = [
    '# === Auto-generated prop helpers (created by the host app) ===',
    'ANALOG_MAX = 255',
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
  lines.push('# Timeline helpers');
  lines.push('script_time = 0.0');
  lines.push('');
  lines.push('def reset_clock() -> None:');
  lines.push('    global script_time');
  lines.push('    script_time = 0.0');
  lines.push('');
  lines.push('def sleep(seconds: float) -> None:');
  lines.push('    global script_time');
  lines.push('    if seconds is None:');
  lines.push('        return');
  lines.push('    script_time += float(seconds)');
  lines.push('');
  lines.push('def hold(throttle=None, roll=None, pitch=None, yaw=None) -> None:');
  lines.push('    command(script_time, throttle, roll, pitch, yaw)');
  lines.push('');
  lines.push('def at(time_s: float, throttle=None, roll=None, pitch=None, yaw=None) -> None:');
  lines.push('    global script_time');
  lines.push('    script_time = float(time_s)');
  lines.push('    command(script_time, throttle, roll, pitch, yaw)');
  lines.push('');
  lines.push('def get_altitude() -> float:');
  lines.push('    return __get_altitude()');
  lines.push('');
  lines.push('def get_estimated_attitude() -> dict:');
  lines.push('    return __get_estimated_attitude()');
  lines.push('');
  lines.push('def get_actual_attitude() -> dict:');
  lines.push('    return __get_actual_attitude()');
  lines.push('');
  lines.push('reset_clock()');
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
  range: [-0.2, 3],
  color: '#22d3ee',
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
  return Math.max(0, rawAltitude) + offset;
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
  const snapshotForScript = latestSnapshot;
  const estimationForScript = latestEstimation;

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

  function applyRotorOverride(index, rpmValue, { source = 'updateRot', annotation } = {}) {
    const label = formatPropLabel(index);
    if (rpmValue === null) {
      let line = `${source}: ${label} オーバーライド解除`;
      if (annotation) line += ` ${annotation}`;
      rotorOverrideMap.set(index, null);
      autopConsole = `${autopConsole}${line}\n`;
      updateAutomationDisplays();
      return null;
    }

    const rpmNumber = Number(rpmValue);
    if (!Number.isFinite(rpmNumber)) {
      throw new Sk.builtin.ValueError(`${source}: RPM には有限の数値を指定してください`);
    }

    const clamped = Math.max(0, Math.min(rpmNumber, propulsionLimits.maxRpm));
    let line = `${source}: ${label} → ${clamped.toFixed(0)} rpm`;
    if (annotation) {
      line += ` ${annotation}`;
    }
    if (clamped !== rpmNumber) {
      line += ` (入力 ${rpmNumber.toFixed(0)} rpm をクランプ)`;
    }

    rotorOverrideMap.set(index, clamped);
    autopConsole = `${autopConsole}${line}\n`;
    updateAutomationDisplays();
    return clamped;
  }

  Sk.configure({
    output: (text) => {
      autopConsole += text;
      updateAutomationDisplays();
    },
    read: builtinRead,
    __future__: Sk.python3,
    execLimit: 10000
  });

  Sk.sysmodules = new Sk.builtin.dict([]);
  rotorLabels.forEach((label, index) => {
    Sk.builtins[`Prop${index + 1}`] = new Sk.builtin.str(label);
  });

  Sk.builtins.__get_altitude = new Sk.builtin.func(function () {
    const altitude = snapshotForScript?.state?.position?.[2] ?? 0;
    return new Sk.builtin.float_(Number(altitude));
  });

  Sk.builtins.__get_actual_attitude = new Sk.builtin.func(function () {
    const euler = snapshotForScript?.state?.euler ?? { roll: 0, pitch: 0, yaw: 0 };
    return toPyAttitude(euler);
  });

  Sk.builtins.__get_estimated_attitude = new Sk.builtin.func(function () {
    const att = estimationForScript ?? snapshotForScript?.state?.euler ?? { roll: 0, pitch: 0, yaw: 0 };
    return toPyAttitude(att);
  });

  Sk.builtins.command = new Sk.builtin.func(function (time, throttle, roll, pitch, yaw) {
    if (time === undefined) {
      throw new Sk.builtin.ValueError('command() には少なくとも時間が必要です');
    }
    const toJs = (value) => {
      if (value === undefined) return undefined;
      const js = Sk.ffi.remapToJs(value);
      return js === null ? undefined : js;
    };
    const timeJs = Number(toJs(time));
    if (!Number.isFinite(timeJs) || timeJs < 0) {
      throw new Sk.builtin.ValueError('時間は0以上の数値で指定してください');
    }
    queue.push({
      time: timeJs,
      throttle: toJs(throttle),
      roll: toJs(roll),
      pitch: toJs(pitch),
      yaw: toJs(yaw)
    });
    return Sk.builtin.none.none$;
  });

  Sk.builtins.updateRot = new Sk.builtin.func(function (prop, rpm) {
    if (prop === undefined || rpm === undefined) {
      throw new Sk.builtin.ValueError('updateRot(prop, rpm) には2つの引数が必要です');
    }
    const identifier = Sk.ffi.remapToJs(prop);
    const index = resolvePropIdentifier(identifier);
    if (index === null) {
      throw new Sk.builtin.ValueError('updateRot(): Prop1〜Prop4 など既知の識別子で指定してください');
    }
    const rpmJs = Sk.ffi.remapToJs(rpm);
    if (rpmJs === null) {
      applyRotorOverride(index, null, { source: 'updateRot' });
      return Sk.builtin.none.none$;
    }
    const rpmNumber = Number(rpmJs);
    if (!Number.isFinite(rpmNumber)) {
      throw new Sk.builtin.ValueError('updateRot(): RPM には数値を指定してください');
    }
    applyRotorOverride(index, rpmNumber, { source: 'updateRot' });
    return Sk.builtin.none.none$;
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
    const rpmTarget = (clampedAnalog / ANALOG_MAX_POWER) * propulsionLimits.maxRpm;
    let annotation = `(analog ${clampedAnalog.toFixed(0)}/${ANALOG_MAX_POWER})`;
    if (clampedAnalog !== analogNumber) {
      annotation += ` 入力 ${analogNumber.toFixed(0)} をクランプ`;
    }
    applyRotorOverride(index, rpmTarget, { source: 'prop.power', annotation });
    return Sk.builtin.none.none$;
  });

  try {
    const scriptBody = `${buildPropPrelude()}\n${dom.pythonEditor.value}`;
    await Sk.misceval.asyncToPromise(() => Sk.importMainWithBody('<stdin>', false, scriptBody, true));
    queue.sort((a, b) => a.time - b.time);
    const overrides = {};
    rotorOverrideMap.forEach((value, index) => {
      overrides[index] = value;
    });
    autopilot.schedule = queue;
    autopilot.pointer = 0;
    autopilot.lastSessionId = timeline.sessionId;
    autopilot.active = queue.length > 0;
    autopilot.rotorOverrides = overrides;

    const overrideCount = Object.keys(overrides).filter((key) => overrides[key] !== undefined).length;
    const summary = [];
    if (queue.length) summary.push(`コマンド ${queue.length} 件`);
    if (overrideCount) summary.push(`プロペラ更新 ${overrideCount} 件`);
    autopStatus = summary.length ? `${summary.join(' / ')}を読み込みました。` : 'コマンドが登録されませんでした。';
    lastAutomationCommand = null;
    updateAutomationDisplays();
    sendRotorOverrides(overrides, true);
    applyAutomation();
    if (!queue.length && !overrideCount) {
      autopConsole = `${autopConsole}\n⚠️ command() 呼び出しが見つかりません。`;
      updateAutomationDisplays();
    }
  } catch (error) {
    autopilot.active = false;
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
  attitudeChart.clear();
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
