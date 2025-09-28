# IMUベース ドローンPID制御デモ

- このリポジトリは、JeNo 3 フレーム＋Gemfan 3018 プロペラ構成（`tmp.json` に収録）をもとにしたクアッドロータの IMU/PID 制御デモを Svelte + Babylon.js で可視化するサンプルです。制御・物理・IMU 推定は Web Worker 上で 200 Hz で動作し、メインスレッドでは 3D 表示・Skulpt 自動化エディタ・実行ログを提供します。3D モデルは起動時にダウンロードされ `public/models/01-FRAME/` にキャッシュされる `01-FRAME/JeNo3_ALL_VERSIONS_1.2.1.stl` を読み込んで描画しています。

## 主要構成

- **UI / 可視化**: Svelte + Babylon.js
- **シミュレーション**: Web Worker 内で剛体力学、プロペラ推力モデル、補償フィルタ、PID 制御を実装
- **機体データ**: `tmp.json` から質量・慣性・プロペラ係数などを読み込み

## セットアップ

```bash
npm install
```

### 開発サーバの起動

```bash
npm start
# or
node server.js
```

上記コマンドはいずれも Vite の開発サーバを Node.js 上で起動します。初回起動時に JeNo 3 STL を自動ダウンロードし、`public/models/`
にキャッシュします。従来通り `npm run dev` での起動も可能です。

### 簡易描画チェック

ブラウザで `http://localhost:5173/simplified.html` を開くと、床・壁・天井と簡易ドローンが回転する軽量レンダラーが表示されます。ここで影まで描画できることを確認してから、`http://localhost:5173` のフル UI を開くとデバッグが容易です。

ブラウザで `http://localhost:5173` を開くと、ドローンモデルと PID コントロール UI が表示されます。
環境変数 `FORCE_REFRESH_JENO_FRAME=true` を付与するとキャッシュ済みの STL を再ダウンロードできます。

### ビルド

```bash
npm run build
```

`dist/` 以下に静的成果物が生成されます。`npm run preview` でローカル確認が可能です。

## 主な UI 操作

- **Roll / Pitch / Yaw セットポイント**: スライダで角度指令を度単位で指定
- **Throttle**: 0〜100% の集団推力指令。ホバリング推力目安を併記
- **タイムライン**: セッション長は 30 s 固定。T=30 s で自動的にリセットされ、ドローンは地面（z=0）から再スタートします。
- **Skulpt 離陸スクリプト**: `command(time_s, throttle, roll, pitch, yaw)` で姿勢・スロットルのタイムラインを記述（`None` で値保持）。`updateRot(Prop1, 1000)` のようにプロペラごとの RPM オーバーライドも指定できます（`Prop1`〜`Prop4` はビルトイン定数、`None` を渡すと解除）。セッション毎の自動再実行トグル付き。
- **リアルタイムチャート**: 高度と姿勢スコア（姿勢誤差 RMS から換算）を 30 s ウインドウで表示。
- **PID ゲイン**: Roll ゲインを変更すると Pitch にも反映（Yaw は初期値固定）
- **機体仕様プレビュー**: `tmp.json` の抜粋（質量、慣性、プロペラ諸元）を表示

> 💡 初期状態ではスロットル 0%・機体は地面上に静止しています。離陸・ホバリング制御は Skulpt スクリプト、または手動スライダで指令してください。

## データフロー概要

```
Svelte UI ─┬─ Babylon.js 可視化（STL モデル）
           ├─ Skulpt (Python → コマンドキュー)
           └─ Web Worker (200 Hz)
                │
                ├─ Quad 物理モデル + 地面接触
                ├─ IMU センサノイズ生成
                ├─ 相補フィルタ姿勢推定
                └─ PID 制御 + ミキサ + 推力→RPM 変換
```

## ライセンス

ソースコード部分は MIT ライセンスです。`tmp.json` のデータは元のライセンス（CC-BY-4.0 等）に従います。
`public/models/01-FRAME/JeNo3_ALL_VERSIONS_1.2.1.stl` は [WE-are-FPV/JeNo-3-3.5 リポジトリの CC-BY ライセンスファイル](https://github.com/WE-are-FPV/JeNo-3-3.5/blob/518b3f75ae36243f16709af16b5cfcd1805c885f/01-FRAME/JeNo3_ALL_VERSIONS_1.2.1.stl)
を起動時にダウンロードして利用しています。
