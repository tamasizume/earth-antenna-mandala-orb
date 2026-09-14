# 導入手順書 — AI音声チャットパック 曼荼羅＆オーブ版

購入者・利用者向けの手順です。プログラミングに詳しくなくても、上から順にやれば動くように書いています。
（PDF化する場合はこのファイルをそのまま変換してください）

---

## 0. 同梱ファイル

| ファイル | 役割 |
|---|---|
| `mandala-orb.js` | 本体（読める版） |
| `mandala-orb.min.js` | 本体（圧縮版・6KB。配布サイトに置くならこちら） |
| `index.html` | デモ＆調整パネル |
| `examples/voice-chat.html` | 実際に会話が動くサンプル（APIキー不要） |
| `README.md` | APIの説明 |
| `LICENSE` | MITライセンス |

---

## 1. まず動かす（5分）

1. フォルダを丸ごと好きな場所に置く
2. `index.html` を **Chrome か Edge** で開く
3. 右パネルの「自動デモ」を押す → オーブが4つの状態を順に切り替わる

> ファイルをダブルクリックで開いて動かない場合（真っ黒のまま）は、ブラウザがローカルファイルの読み込みを止めています。
> フォルダで右クリック →「ターミナルで開く」→ 次を実行して、表示されたアドレス（http://localhost:8765）を開いてください。
> ```
> python -m http.server 8765
> ```
> Pythonが無い場合は VS Code の「Live Server」拡張でも同じことができます。

---

## 2. 見た目を決める（10分）

`index.html` の右パネルで動かしながら決めます。

| 項目 | 意味 | おすすめ |
|---|---|---|
| パターン | 曼荼羅 / 丸いアイコン | チャットの雰囲気で。落ち着き→曼荼羅、親しみ→丸いアイコン |
| 密度 | 粒子の数 | 300（多いほど重くなる。スマホなら200以下） |
| 感度 | 音への反応の強さ | 1.4（声が小さい人向けなら2.0） |
| 花びらの枚数 | 曼荼羅の対称数 | 15 |
| 色 | 基準色 / 外側の色 | ブランドカラーに |

決まったら、パネル一番下の **「組み込みコード」** をコピーしておきます。

---

## 3. 自分のページに組み込む（15分）

### 3-1. HTMLに2行足す

```html
<canvas id="orb" style="width:240px;height:240px"></canvas>
<script src="mandala-orb.min.js"></script>
```

`mandala-orb.min.js` はHTMLと同じフォルダに置きます。
`width` / `height` を変えれば大きさが変わります（正方形推奨）。

### 3-2. コピーしたコードを貼る

```html
<script>
  const orb = MandalaOrb.create(document.getElementById('orb'), {
    pattern: 'mandala',
    density: 300,
    sensitivity: 1.4,
    symmetry: 15,
    color: '#6eafff',
    colorEdge: '#cd6ee6',
  });
</script>
```

ここまでで、ページを開くと待機状態のオーブが回ります。

### 3-3. 会話の状態を渡す

あなたのチャットの処理の中で、状態が変わるたびに1行呼びます。

```js
orb.setState('listening'); // マイクを開いたとき
orb.setState('thinking');  // AIに送信したとき
orb.setState('speaking');  // 返答の再生を始めたとき
orb.setState('idle');      // 再生が終わったとき
```

### 3-4. 音量を渡す

マイクやTTSの音量を 0〜1 で渡すと、オーブが反応します。
`examples/voice-chat.html` の `startMeter()` をそのまま使えます。

```js
const ctx = new AudioContext();
const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
source.connect(analyser); // source = マイク or 音声再生の要素
const buf = new Uint8Array(analyser.frequencyBinCount);
(function loop() {
  requestAnimationFrame(loop);
  analyser.getByteFrequencyData(buf);
  const n = Math.floor(buf.length * 0.35);
  let s = 0; for (let i = 0; i < n; i++) s += buf[i];
  orb.setLevel(Math.min(1, (s / n / 255) * 1.6));
})();
```

**音量が取れない場合**（ブラウザ内蔵の音声合成など）は、`examples/voice-chat.html` の `speak()` のように擬似的な音量を渡せば見た目は成立します。

---

## 4. 自分のAIに繋ぐ

`examples/voice-chat.html` を開き、`askAI` 関数を書き換えます。

```js
async function askAI(userText) {
  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: userText }),
  });
  return (await r.json()).reply;
}
```

`/api/chat` は、あなたのサーバーで Claude / ChatGPT / Gemini を呼ぶ入口です。

> **重要：APIキーはブラウザ側のHTMLやJSに書かないでください。** 誰でも見られてしまいます。必ずサーバー側に置きます。

---

## 5. よくある質問

**Q. 真っ黒で何も出ない**
A. ①Chrome/Edgeで開いているか ②`mandala-orb.js` がHTMLと同じフォルダにあるか ③1章の「ローカルファイル」の注意 を確認してください。

**Q. 動きが重い**
A. 密度を下げてください（`density: 150` など）。スマホは200以下を推奨します。

**Q. 背景を黒にしたい／透明のままにしたい**
A. `background: '#000'` を足すと黒、書かなければ透明（下のページが透けます）。

**Q. 状態が切り替わるとき、いきなり変わらないようにしたい**
A. すでに約0.4秒でなめらかに移行します。もっとゆっくりにしたい場合は `mandala-orb.js` 内の `0.4` を大きくしてください。

**Q. 思考中の縮み具合や脈動を変えたい**
A. `states` で上書きできます。
```js
MandalaOrb.create(canvas, { states: { thinking: { scale: 0.9, pulse: 0.05 } } });
```

**Q. マイクを使い終わったあと、ブラウザのタブに赤い●が残る**
A. `AudioContext` を `close()` し、マイクの `track.stop()` を呼んでください（サンプルの `stopMeter()` がその処理です）。

---

## 6. サポート

- 無料版：GitHubのIssue
- 統合パック購入者：購入サイトのメッセージで「設定相談1回」をご利用ください（環境・やりたいことを書いていただければ、設定値やコードの差分をお返しします）
