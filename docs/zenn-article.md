---
title: "AI音声チャットに「聞いてる・考えてる・話してる」を見せる — 状態連動の音声ビジュアライザーを依存ゼロで作った"
emoji: "🔮"
type: "tech"
topics: ["javascript", "canvas", "webaudio", "ai", "claude"]
published: true
---

AI音声チャットを作っていて、一番気になったのは「AIが今なにをしているのか」が画面から分からないことでした。マイクは拾えているのか、考えているのか、もう話し始めているのか。テキストなら「…」で済むところが、音声だと無音の数秒が長い。

そこで、**会話の状態（idle / listening / thinking / speaking）に合わせて自動で表情を変える光のオーブ**を作りました。依存ゼロ・1ファイル・MITで公開しています。

- デモ: https://tamasizume.github.io/earth-antenna-mandala-orb/
- リポジトリ: https://github.com/tamasizume/earth-antenna-mandala-orb

この記事では、設計で悩んだところと、実装の要点を書きます。

## 設計方針：音声処理を持たない

最初は「マイクを開いてAnalyserNodeで音量を取って…」まで全部ライブラリに入れようとしましたが、やめました。理由は、繋ぐ先が毎回違うからです。マイク、VOICEVOXの再生、ElevenLabsのストリーム、ブラウザ内蔵の`speechSynthesis`（音量が取れない）。全部に対応しようとすると肥大化するし、結局どれかに合わない。

なので、ライブラリが受け取るのは2つだけにしました。

```js
const orb = MandalaOrb.create(canvas, { pattern: 'mandala' });
orb.setState('listening'); // idle | listening | thinking | speaking
orb.setLevel(0.42);        // 音量 0〜1、毎フレーム渡す
```

「今どの状態か」と「今の音量」。音量をどう取るかは呼ぶ側の責任です。これで Claude でも ChatGPT でも、TTSが何でも、同じ書き方で使えます。

音量が取れない `speechSynthesis` の場合は、擬似的な揺らぎを渡せば見た目は成立します。

```js
// speechSynthesis 再生中に擬似音量を流す
const tt = performance.now() / 1000;
orb.setLevel(0.4 + 0.3 * Math.sin(tt * 6.1) + 0.2 * Math.sin(tt * 14.3));
```

## 状態ごとの「効き方」をパラメータにする

4つの状態それぞれに専用の描画コードを書くと、パターン（曼荼羅／オーブ）×状態の組み合わせで爆発します。代わりに、状態は「倍率の束」として持ちました。

```js
states: {
  idle:      { audio: 0.0, density: 1.0, scale: 1.00, pulse: 0.02, pulseHz: 0.25, spin: 1.0 },
  listening: { audio: 1.0, density: 1.0, scale: 1.00, pulse: 0.00, pulseHz: 0.00, spin: 1.6 },
  thinking:  { audio: 0.0, density: 0.7, scale: 0.85, pulse: 0.08, pulseHz: 0.9,  spin: 0.6 },
  speaking:  { audio: 1.2, density: 1.0, scale: 1.05, pulse: 0.00, pulseHz: 0.00, spin: 1.2 },
}
```

- `audio`: 音量の効き方。idle と thinking は 0（音に反応しない）
- `density`: 描く粒子の割合。thinking で 0.7 に間引くと「静まった」感じが出る
- `scale` / `pulse` / `pulseHz`: 全体の大きさと脈動。thinking は縮んでゆっくり脈打つ
- `spin`: 回転速度の倍率

描画コードはこの倍率を読むだけなので、パターンを増やしても状態のコードは増えません。利用者側も `states: { thinking: { scale: 0.9 } }` のように部分的に上書きできます。

### 状態遷移は「目標値へ寄せる」

`setState()` で倍率を即座に切り替えると、画面がカクッと変わります。なので内部では現在値を持ち、毎フレーム目標値へ指数的に寄せています。

```js
const ease = 1 - Math.pow(0.001, dt / 0.4); // 約0.4秒で99.9%到達
for (const key in target) cur[key] = lerp(cur[key], target[key], ease);
```

`dt` ベースなのでフレームレートが落ちても遷移時間は変わりません。

### 音量もなめらかにする（アタック速く、リリース遅く）

生の音量をそのまま使うとチラつきます。立ち上がりは速く、減衰はゆっくり。

```js
const k = target > level ? opts.attack : opts.release; // 0.35 / 0.12
level = lerp(level, target, k);
```

## 描画：透明背景のまま残像を出す

曼荼羅は粒子の残像（トレイル）が肝ですが、よくある「半透明の黒で塗って消す」方式だと背景が黒に固定されます。チャットUIの上に重ねたいので、透明を保ったまま消したい。

`destination-out` で「アルファだけ削る」と解決します。

```js
ctx.globalCompositeOperation = 'destination-out';
ctx.fillStyle = 'rgba(0,0,0,0.16)'; // 色は無視され、アルファ分だけ消える
ctx.fillRect(0, 0, W, H);
```

これで下のページが透けたまま残像が出ます。背景色を指定したい場合だけ `destination-over` で後ろに敷きます。

## 曼荼羅：1粒子をN回転コピーする

対称模様は、粒子を1つ動かして、それを N 回転して描くだけです（N=15 が今の既定）。

```js
for (let k = 0; k < copies; k++) {
  const a = wedge * k;
  const rx = bx * Math.cos(a) - by * Math.sin(a);
  const ry = bx * Math.sin(a) + by * Math.cos(a);
  ctx.arc(cx + rx, cy + ry, size, 0, Math.PI * 2);
}
```

粒子の移動はノイズ風の流れ場（sin/cos の合成）に沿わせ、音量で速度と大きさを上げます。最初は粒子が四角い範囲で動いていて、音量が上がると正方形のキャンバスの角にはみ出したので、**円の外に出たら再生成**するようにしました。

```js
const rr = Math.sqrt(x * x + y * y);
if (rr > minDim * 0.47 || p.life > p.maxLife) { spawn(p); continue; }
```

## ハマったところ

**`lighter` 合成で白飛びする**
加算合成×15コピー×音量で粒子を大きくすると、発話中に真っ白になりました。粒子サイズの音量係数を 1.8→0.9、アルファを 0.55→0.45 に下げて落ち着きました。加算合成は「重なる回数」を意識しないと簡単に飽和します。

**AudioContext のリーク**
デモにマイク入力を付けたとき、切り替えのたびに `AudioContext` を作っていて、タブに赤い●が残り続けました。1つだけ作り、停止時に必ず `close()` と `track.stop()`。`visibilitychange` で `suspend`/`resume` も入れています。

**録画はキャンバスから直接**
デモ動画を作るのに画面録画ソフトは使わず、`canvas.captureStream(30)` + `MediaRecorder` で書き出しています。1920×1080 の裏キャンバスに別インスタンスを立てて、状態を順に切り替えながら録るだけ。`pixelRatio: 1` を指定できるようにして、実寸で出るようにしました。

## まとめ

- ライブラリは「状態」と「音量」だけ受け取る。音声処理は持たない
- 状態は倍率の束として持ち、毎フレーム目標値へ寄せる
- 残像は `destination-out` で透明を保つ
- 加算合成は重なり回数に注意

ソースは1ファイル（圧縮版 6KB）で、`examples/voice-chat.html` にブラウザ内蔵の音声認識＋合成だけで実際に会話が動くサンプルも入れています。`askAI` 関数を自分のAI呼び出しに差し替えれば、そのまま音声チャットになります。

https://github.com/tamasizume/earth-antenna-mandala-orb

「こういう状態を足したい」「この模様が欲しい」があれば、Issueで教えてください。
