/*
 * MandalaOrb — 会話状態連動の音声ビジュアライザー(曼荼羅 / 丸いアイコン)
 *
 * 依存なし・音声処理なし。外から「状態」と「音量(0..1)」を渡すだけで描く。
 * どのAI(Claude / ChatGPT / Gemini / 自作ボット)からでも同じ呼び方で使える。
 *
 *   const orb = MandalaOrb.create(canvasEl, { pattern: 'mandala', density: 300 });
 *   orb.setState('listening');   // idle | listening | thinking | speaking
 *   orb.setLevel(0.42);          // マイクでもTTSでも、音量0..1を毎フレーム渡す
 *   orb.set({ sensitivity: 2 }); // 実行中に設定変更
 *   orb.destroy();               // 片付け
 *
 * 元ネタ: earth-antenna-hyperframes/particle-lab.html の「曼荼羅(対称)」と
 * 「丸いアイコン(Siri風)」をリアルタイム用に書き直したもの。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MandalaOrb = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------- 既定値 ----------------
  const DEFAULTS = {
    pattern: 'mandala',      // 'mandala' | 'orb'
    density: 300,            // 粒子数(曼荼羅のみ)
    sensitivity: 1.4,        // 音の反応の強さ(0.5..3 目安)
    symmetry: 15,            // 曼荼羅の花びら数
    color: '#6eafff',        // 基準色(中間)
    colorEdge: '#cd6ee6',    // 外側の色(曼荼羅の縁)
    spin: 0.12,              // アイドル時の回転速度(rad/s)。負で逆回転
    trail: 0.16,             // 曼荼羅の残像の消え方(0..1、大きいほど早く消える)
    orbMix: 0.6,             // 丸いアイコン: 色の混ざり具合
    background: 'transparent', // 'transparent' か CSS色。透明なら下地の上に重ねられる
    pixelRatio: 0,           // 0=自動(devicePixelRatio)。録画などで実寸にしたいときは1
    attack: 0.35,            // 音量の立ち上がりの滑らかさ(0..1、大きいほど速い)
    release: 0.12,           // 音量の減衰の滑らかさ
    // 状態ごとの効き方。audio=感度倍率, density=粒子数倍率, scale=全体の大きさ,
    // pulse=脈動の振幅, pulseHz=脈動の速さ, spin=回転倍率
    states: {
      idle:      { audio: 0.0, density: 1.0, scale: 1.00, pulse: 0.02, pulseHz: 0.25, spin: 1.0 },
      listening: { audio: 1.0, density: 1.0, scale: 1.00, pulse: 0.00, pulseHz: 0.00, spin: 1.6 },
      thinking:  { audio: 0.0, density: 0.7, scale: 0.85, pulse: 0.08, pulseHz: 0.9,  spin: 0.6 },
      speaking:  { audio: 1.2, density: 1.0, scale: 1.05, pulse: 0.00, pulseHz: 0.00, spin: 1.2 },
    },
  };
  const STATE_NAMES = ['idle', 'listening', 'thinking', 'speaking'];

  // ---------------- 小道具 ----------------
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return { r: 110, g: 175, b: 255 };
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function mixRgb(a, b, t) {
    return { r: Math.round(lerp(a.r, b.r, t)), g: Math.round(lerp(a.g, b.g, t)), b: Math.round(lerp(a.b, b.b, t)) };
  }
  const WHITE = { r: 255, g: 255, b: 255 };

  function deepMergeStates(base, over) {
    const out = {};
    for (const k of STATE_NAMES) out[k] = Object.assign({}, base[k], (over && over[k]) || {});
    return out;
  }

  // ---------------- 本体 ----------------
  function create(canvas, options) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new Error('MandalaOrb.create: canvas要素を渡してください');
    const ctx = canvas.getContext('2d');
    const opts = Object.assign({}, DEFAULTS, options || {});
    opts.states = deepMergeStates(DEFAULTS.states, options && options.states);

    // 内部状態
    let state = 'idle';
    let targetLevel = 0, level = 0;
    let t = 0, lastMs = 0, rot = 0, pulseClock = 0;
    let running = false, rafId = 0, destroyed = false;
    let W = 0, H = 0, dpr = 1;
    let particles = [];
    // 状態遷移をなめらかにするため、状態パラメータは目標値へ毎フレーム寄せる
    const cur = Object.assign({}, opts.states.idle);
    let colorMid = hexToRgb(opts.color), colorEdge = hexToRgb(opts.colorEdge);

    // --- サイズ(CSSサイズ×DPR)。ResizeObserverがあれば追従 ---
    function resize() {
      const rect = canvas.getBoundingClientRect();
      dpr = opts.pixelRatio > 0 ? opts.pixelRatio : Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, Math.round(rect.width || canvas.width));
      H = Math.max(1, Math.round(rect.height || canvas.height));
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      clearAll();
    }
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(resize); ro.observe(canvas); }
    resize();

    function clearAll() {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      if (opts.background !== 'transparent') { ctx.fillStyle = opts.background; ctx.fillRect(0, 0, W, H); }
    }

    // --- 曼荼羅の粒子 ---
    function spawn(p) {
      const R = Math.min(W, H) * 0.44;
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * R;
      p.px = Math.cos(a) * r;
      p.py = Math.sin(a) * r;
      p.z = Math.random();
      p.life = 0;
      p.maxLife = 70 + Math.random() * 140;
      p.size = 0.6 + Math.random() * 1.6;
      return p;
    }
    function makeParticles(n) {
      particles = [];
      for (let i = 0; i < n; i++) particles.push(spawn({}));
    }
    makeParticles(opts.density);

    function flowAngle(x, y, tt) {
      return (Math.sin(x * 0.0035 + tt * 0.35) + Math.cos(y * 0.0045 - tt * 0.28) + Math.sin((x + y) * 0.002 + tt * 0.15)) * Math.PI;
    }
    function edgeColor(distF) {
      // 白(中心) → 基準色(中間) → 外側色(縁)
      return distF <= 0.5 ? mixRgb(WHITE, colorMid, distF / 0.5) : mixRgb(colorMid, colorEdge, (distF - 0.5) / 0.5);
    }

    function drawMandala(dt) {
      const sens = opts.sensitivity * cur.audio;
      const minDim = Math.min(W, H);
      const cx = W / 2, cy = H / 2;

      // 残像: 透明を保ったまま少しずつ消す(下地の色に依存しない)
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,' + opts.trail + ')';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      if (opts.background !== 'transparent') {
        ctx.save(); ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = opts.background; ctx.fillRect(0, 0, W, H); ctx.restore();
      }

      const copies = Math.max(1, Math.round(opts.symmetry));
      const wedge = (Math.PI * 2) / copies;
      const speed = (1.0 + level * 3.0 * sens) * (minDim / 1080) * (dt * 60);
      const activeCount = Math.round(particles.length * cur.density);
      const breathe = 1 + cur.pulse * Math.sin(pulseClock * Math.PI * 2);
      const scale = cur.scale * breathe;
      const cosR = Math.cos(rot), sinR = Math.sin(rot);

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < activeCount; i++) {
        const p = particles[i];
        let x = p.px, y = p.py;
        const angle = flowAngle(x, y, t) + (level * sens) * Math.sin(t * 3 + x * 0.01);
        x += Math.cos(angle) * speed;
        y += Math.sin(angle) * speed * 0.6;
        p.life += dt * 60;
        // 円の外に出たら再生成(キャンバスが正方形でも丸く収まる)
        const rr = Math.sqrt(x * x + y * y);
        if (rr > minDim * 0.47 || p.life > p.maxLife) { spawn(p); continue; }
        p.px = x; p.py = y;

        const c = edgeColor(clamp01(rr / (minDim * 0.47)));
        const zScale = 0.3 + p.z * 1.6;
        const size = p.size * (0.7 + level * 0.9 * sens) * zScale * (minDim / 1080) * 1.0 * scale;
        const alpha = (0.45 + level * 0.3 * cur.audio) * (0.28 + p.z * 0.72);
        ctx.fillStyle = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha + ')';

        // 全体回転 + 収縮スケールを掛けた位置
        const sx = x * scale, sy = y * scale;
        const bx = sx * cosR - sy * sinR, by = sx * sinR + sy * cosR;
        for (let k = 0; k < copies; k++) {
          const a = wedge * k;
          const rx = bx * Math.cos(a) - by * Math.sin(a);
          const ry = bx * Math.sin(a) + by * Math.cos(a);
          ctx.beginPath();
          ctx.arc(cx + rx, cy + ry, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // --- 丸いアイコン(Siri風) ---
    function drawOrb() {
      clearAll();
      const sens = opts.sensitivity * cur.audio;
      const minDim = Math.min(W, H);
      const cx = W / 2, cy = H / 2;
      const breathe = 1 + cur.pulse * Math.sin(pulseClock * Math.PI * 2);
      const baseR = minDim * 0.26 * cur.scale * breathe * (1 + level * 0.35 * sens);
      const react = clamp01(level * cur.audio);
      const EC = colorMid;
      const ECsoft = mixRgb(WHITE, EC, 0.55);
      const tight = 0.26 - opts.orbMix * 0.16;
      const spinT = rot * 4; // 回転をblobの周回に流用

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const blobs = [
        { c: WHITE,  ang: spinT * 0.6,         orbit: tight * 0.5 },
        { c: EC,     ang: spinT * 0.5 + 2.1,   orbit: tight },
        { c: ECsoft, ang: -spinT * 0.45 + 4.2, orbit: tight * 1.1 },
        { c: EC,     ang: -spinT * 0.35 + 1.0, orbit: tight * 0.7 },
      ];
      const blobAlpha = 0.45 + opts.orbMix * 0.3;
      for (const b of blobs) {
        const bx = cx + Math.cos(b.ang) * baseR * b.orbit;
        const by = cy + Math.sin(b.ang) * baseR * b.orbit;
        const r = baseR * (0.80 + 0.14 * Math.sin(t * 1.3 + b.ang));
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, r);
        g.addColorStop(0, 'rgba(' + b.c.r + ',' + b.c.g + ',' + b.c.b + ',' + blobAlpha + ')');
        g.addColorStop(1, 'rgba(' + b.c.r + ',' + b.c.g + ',' + b.c.b + ',0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
      }

      // 輪郭: 細い線の束が絡み合う。音に反応すると縁の色が外側色へ寄って光る
      const band = mixRgb(WHITE, colorEdge, react * 0.8);
      const strands = 7, steps = 84;
      for (let s = 0; s < strands; s++) {
        const seed = s * 1.7;
        const jitter = 1 + (s - (strands - 1) / 2) * 0.018;
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const wob = 1
            + 0.05 * Math.sin(a * 5 + seed + t * (2.1 + s * 0.07))
            + 0.035 * Math.sin(a * (8.7 + s * 0.6) - t * (1.6 + s * 0.05))
            + 0.028 * Math.sin(a * (3.3 + s * 0.3) + seed + t * 0.9)
            + 0.02 * Math.sin(a * 13 + t * 2.7 - seed);
          const rr = baseR * 0.84 * wob * jitter; // 光の玉に絡む位置まで寄せる
          const x = cx + Math.cos(a + rot) * rr, y = cy + Math.sin(a + rot) * rr;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = 'rgba(' + band.r + ',' + band.g + ',' + band.b + ',' + (0.16 + react * 0.16) + ')';
        ctx.lineWidth = Math.max(0.6, baseR * 0.012);
        ctx.shadowBlur = baseR * (0.05 + react * 0.35);
        ctx.shadowColor = 'rgba(255,255,255,' + (0.3 + react * 0.6) + ')';
        ctx.stroke();
      }
      ctx.restore();
    }

    // --- 毎フレーム ---
    function frame(nowMs) {
      if (destroyed) return;
      rafId = requestAnimationFrame(frame);
      const dt = lastMs ? Math.min(0.05, (nowMs - lastMs) / 1000) : 1 / 60;
      lastMs = nowMs;
      t += dt;

      // 音量のなめらか化(立ち上がりは速く、減衰はゆっくり)
      const k = targetLevel > level ? opts.attack : opts.release;
      level = lerp(level, targetLevel, k);

      // 状態パラメータを目標へ寄せる(約0.4秒でほぼ到達)
      const tgt = opts.states[state];
      const ease = 1 - Math.pow(0.001, dt / 0.4);
      for (const key in tgt) cur[key] = lerp(cur[key] == null ? tgt[key] : cur[key], tgt[key], ease);

      rot += opts.spin * cur.spin * dt * (1 + level * cur.audio * 1.5);
      pulseClock += cur.pulseHz * dt;

      if (opts.pattern === 'orb') drawOrb(); else drawMandala(dt);
    }

    // ---------------- 公開API ----------------
    const api = {
      setState(name) {
        if (STATE_NAMES.indexOf(name) < 0) throw new Error('MandalaOrb.setState: ' + STATE_NAMES.join(' | ') + ' のどれかを指定');
        state = name;
        return api;
      },
      setLevel(v) { targetLevel = clamp01(Number(v) || 0); return api; },
      set(patch) {
        patch = Object.assign({}, patch || {});
        if (patch.states) { opts.states = deepMergeStates(opts.states, patch.states); delete patch.states; }
        const prevPattern = opts.pattern, prevDensity = opts.density;
        Object.assign(opts, patch);
        if ('color' in patch) colorMid = hexToRgb(opts.color);
        if ('colorEdge' in patch) colorEdge = hexToRgb(opts.colorEdge);
        if (opts.density !== prevDensity) makeParticles(Math.max(1, Math.round(opts.density)));
        if (opts.pattern !== prevPattern) clearAll();
        return api;
      },
      get() { return Object.assign({}, opts, { states: deepMergeStates(opts.states, null) }); },
      get state() { return state; },
      get level() { return level; },
      start() { if (!running && !destroyed) { running = true; lastMs = 0; rafId = requestAnimationFrame(frame); } return api; },
      stop() { running = false; cancelAnimationFrame(rafId); return api; },
      destroy() { api.stop(); destroyed = true; if (ro) ro.disconnect(); clearAll(); },
      resize: resize,
      STATES: STATE_NAMES.slice(),
    };
    api.start();
    return api;
  }

  return { create: create, DEFAULTS: DEFAULTS, STATES: STATE_NAMES.slice() };
});
