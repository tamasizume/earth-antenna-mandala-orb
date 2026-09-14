# AI音声チャットパック 曼荼羅＆オーブ版 (Mandala Orb)

会話の状態(idle / listening / thinking / speaking)と音量を外から渡すだけで動く、音声ビジュアライザーです。
マイク処理・TTS・APIは一切含まないので、Claude / ChatGPT / Gemini / 自作ボットのどれからでも同じ呼び方で使えます。

▶ デモ(ブラウザで動く): https://tamasizume.github.io/earth-antenna-mandala-orb/
▶ ローカルでは `index.html` をChrome/Edgeで開く(調整パネル・自動デモ・録画付き)
▶ 実際に会話するサンプル: `examples/voice-chat.html`(ブラウザ内蔵の音声認識/合成のみ、APIキー不要)

- `mandala-orb.js` … 本体(依存なし、1ファイル) / `mandala-orb.min.js` … 圧縮版(6KB)
- `index.html` … デモ&調整パネル(密度・感度・花びら数・色・状態切替・マイク/ファイル入力・録画)
- `examples/voice-chat.html` … 音声チャット接続サンプル(`askAI` を自分のAIに差し替えて使う)
- `docs/setup-guide.md` … 導入手順書
- ライセンス: MIT
- 元ネタ: 地球アンテナ(podcast)の動画用曼荼羅システムをリアルタイム用に書き直したもの

## 使い方(3行)

```html
<canvas id="orb" style="width:240px;height:240px"></canvas>
<script src="mandala-orb.js"></script>
<script>
  const orb = MandalaOrb.create(document.getElementById('orb'), {
    pattern: 'mandala',   // 'mandala' | 'orb'
    density: 300,         // 粒子数
    sensitivity: 1.4,     // 音の反応の強さ
    symmetry: 15,         // 花びらの枚数
  });
  orb.setState('listening'); // 会話の状態を切り替える
  orb.setLevel(0.42);        // 音量(0..1)を毎フレーム渡す
</script>
```

## API

| メソッド | 説明 |
|---|---|
| `MandalaOrb.create(canvas, options)` | 生成して即描画開始 |
| `orb.setState(name)` | `idle` / `listening` / `thinking` / `speaking` |
| `orb.setLevel(0..1)` | 音量を渡す(内部でなめらかに補間) |
| `orb.set({...})` | 実行中に設定変更(density, sensitivity, symmetry, color, pattern, states...) |
| `orb.get()` | 現在の設定を取得 |
| `orb.start()` / `orb.stop()` | 描画の再開/停止 |
| `orb.destroy()` | 片付け(ResizeObserver解除・停止) |

## 調整の3層

1. **設定オブジェクト** — `create()` の第2引数 / `set()`。他のAIに組み込むときはここだけ。
2. **デモのスライダー** — `index.html` の右パネル。決まった値は「組み込みコード」欄に自動で出るのでコピーして使う。
3. **状態ごとの倍率** — `states` で上書き可能:

```js
MandalaOrb.create(canvas, {
  states: {
    idle:      { audio: 0.0, density: 1.0, scale: 1.00, pulse: 0.02, pulseHz: 0.25, spin: 1.0 },
    listening: { audio: 1.0, density: 1.0, scale: 1.00, pulse: 0.00, pulseHz: 0.00, spin: 1.6 },
    thinking:  { audio: 0.0, density: 0.7, scale: 0.85, pulse: 0.08, pulseHz: 0.9,  spin: 0.6 },
    speaking:  { audio: 1.2, density: 1.0, scale: 1.05, pulse: 0.00, pulseHz: 0.00, spin: 1.2 },
  }
});
```

- `audio` = 感度倍率(0で音に反応しない)
- `density` = 粒子数倍率
- `scale` = 全体の大きさ
- `pulse` / `pulseHz` = 脈動の振幅と速さ(thinkingの「収縮・脈動」)
- `spin` = 回転速度倍率

## 音量の取り方(例)

マイクでもTTSでも、AnalyserNodeで音量を取って `setLevel()` に渡すだけです。

```js
const ctx = new AudioContext();
const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
source.connect(analyser);               // source = マイク or TTSのaudio要素
const buf = new Uint8Array(analyser.frequencyBinCount);
(function loop() {
  requestAnimationFrame(loop);
  analyser.getByteFrequencyData(buf);
  const n = Math.floor(buf.length * 0.35);
  let s = 0; for (let i = 0; i < n; i++) s += buf[i];
  orb.setLevel(Math.min(1, (s / n / 255) * 1.6));
})();
// 使い終わったら必ず: source.disconnect(); ctx.close();
```

## 注意

- 背景は既定で透明。チャットUIの上に重ねられます(`background: '#000'` で塗りつぶしも可)。
- AudioContextは使い終わったら `close()` してください(デモは停止・ページ離脱時に自動で閉じます)。
- HyperFrames動画用ではありません(リアルタイム描画専用。動画側は `earth-antenna-hyperframes` を使う)。

## 自動デモの録画(YouTube用)

デモページの「自動デモを録画して保存」を押すと、1920×1080・背景黒で
曼荼羅 → 丸いアイコン の順に4状態を1周ずつ回した約24秒の `mandala-orb-demo.webm` がダウンロードされます。
(Chrome / Edge 推奨。右のパネルは映らず、映像だけが録れます)

YouTubeは .webm のままアップロードできますが、mp4 にしたい場合:

```bash
ffmpeg -i mandala-orb-demo.webm -c:v libx264 -pix_fmt yuv420p -crf 18 -r 30 mandala-orb-demo.mp4
```
