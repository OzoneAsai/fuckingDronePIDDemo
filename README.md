# IMUベース ドローンPID制御デモ

JeNo 3 フレーム（`tmp.json` に含まれる機体データ）をもとにしたクアッドロータを、IMU 推定と PID 制御でホバリングさせるブラウザデモです。Babylon.js でハンガー内の 3D シーンを描画し、Web Worker 上で 200 Hz の物理・推定・PID ループを駆動します。Skulpt を通して Python コマンドを実行し、離陸スケジュールやロータの RPM をスクリプトから上書きできます。

## 主な構成

- **UI / 可視化**: Vite + Vanilla JavaScript + Babylon.js
- **シミュレーション**: Web Worker 内で剛体力学、プロペラ推力モデル、相補フィルタ、PID 制御を実装
- **機体データ**: `tmp.json` から質量・慣性・推力係数を読込
- **Skulpt 連携**: `prop_*.power()` でロータのアナログ出力を直接制御し、`automation_setup()` / `automation_tick(ctx)` / `automation_reset()` の各フックから `getAbsAlt()`・`getToFAlt()`・`getIMUVal()`・`getMagVal()` など最新センサーを参照してリアルタイム制御を記述（`command()` / `updateRot()` は無効化）

## セットアップ

```bash
npm install
```

### 開発サーバの起動

```bash
npm start
# or
node server.js
# or
npm run dev
```

初回起動時に JeNo 3 STL モデルを GitHub からダウンロードし、`public/models/01-FRAME/JeNo3_ALL_VERSIONS_1.2.1.stl` にキャッシュします。環境変数 `FORCE_REFRESH_JENO_FRAME=true` を付与するとキャッシュを破棄して再取得します。

ブラウザで `http://localhost:5173` を開くと、ドローンが床に着地した状態で表示され、左ペインに 3D シーンとテレメトリ、右ペインにセットポイント・PID・Skulpt エディタが並びます。

### サービスワーカー

開発サーバとビルド成果物の双方で `/service-worker.js` を登録し、以下をキャッシュします。

- ルート HTML (`/index.html`)
- Vite ビルド成果物（`/assets/` 配下）
- `tmp.json` と STL モデル (`/models/` 配下)

ブラウザコンソールにインストール・更新・フェッチイベントを詳細ログとして出力します。

### ビルド

```bash
npm run build
npm run preview
```

`dist/` 配下に静的ファイルが生成されます。`npm run preview` でローカル確認が可能です。

## UI の見どころ

- **タイムライン**: 30 s セッションを視覚化。T=30 s で世界がリセットし、地面 (z=0) から再スタートします。`Reset World` ボタンで即時リセットも可能です。
- **ハンガーシーン**: 床・壁・天井と影を備えた Babylon.js の室内空間に JeNo 3 STL を配置。推定姿勢は半透明ワイヤーフレームで重ねて表示します。
- **セットポイント & PID**: Roll / Pitch / Yaw を度単位で、Throttle を 0〜100 % で指示。PID ゲインは各軸ごとにスライダで調整し、即座に Web Worker へ送信されます。
- **Skulpt 自動化**:
  - `automation_setup(ctx)` で初期化、`automation_tick(ctx)` で各ワーカーフレーム（約 60 Hz）の最新センサー `ctx` を受け取り、`prop_*.power()` でロータ出力を更新。`automation_reset(ctx)` はセッションリセット時に呼ばれます。
  - `getAbsAlt()` / `get_tof_alt()` / `getIMUVal()` / `getMagVal()` / `get_actual_attitude()` / `get_estimated_attitude()` といったビルトインで IMU 推定を取得し、`get_timeline()` で現在時刻・残り時間を確認可能。
  - プレリュードで `ANALOG_MAX` / `HOVER_ANALOG` / `HOVER_RPM` / `FIELD_HEIGHT` / `ALTITUDE_BAND` / `RAD_TO_DEG` / `clamp()` などの定数・ヘルパーを自動定義済み。
  - `prop_1.power(…)` など 0〜255 指定でロータを駆動（prop_1〜prop_4 は第一象限から時計回りに対応）。`command()` / `updateRot()` は利用できません。
  - 実行ログとエラーはコンソールに逐次表示され、セッションリセット時には Python 側の `automation_reset` が呼ばれます。
- **Altitude スコア**: フィールド上限 50 m、狙いの高度コリドー 23〜26 m に滞在した累積時間を得点化し、メトリクスとチャートで可視化。
- **テレメトリチャート**: 高度（STL 接地オフセット込み）、高度スコア、姿勢スコア（姿勢誤差の RMS を 0〜100 点に換算）を 30 s ウィンドウでプロット。

## データフロー概要

```
UI (Vanilla JS)
 ├─ Babylon.js ハンガー表示
 ├─ Skulpt (Python automation_tick → prop.power overrides)
 └─ Web Worker (200 Hz)
      │
      ├─ Quad 剛体力学 + 地面接触
      ├─ プロペラ推力・モータ一次遅れ
      ├─ IMU ノイズ生成 + 相補フィルタ
      └─ PID 制御 + ミキサ + 推力→RPM
```

## ライセンス

ソースコードは MIT License です。`tmp.json` の各種データは元のライセンス（CC-BY-4.0 等）に従います。`public/models/01-FRAME/JeNo3_ALL_VERSIONS_1.2.1.stl` は [WE-are-FPV/JeNo-3-3.5 リポジトリの CC-BY ライセンスファイル](https://github.com/WE-are-FPV/JeNo-3-3.5/blob/518b3f75ae36243f16709af16b5cfcd1805c885f/01-FRAME/JeNo3_ALL_VERSIONS_1.2.1.stl) を起動時にダウンロードして利用しています。
