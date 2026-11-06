/* worker.js — 种子过滤全扫描(专用早退匹配器)
 * 语义必须与 core.levelup 完全一致(node cross_check.js 验证)
 * 主线程预组每级输入;观测比较用决定增益(升级画面闪烁值)
 */
(function boot(root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // Node 交叉验证用
  root.FEWorkerMatch = api;
  // 页面环境:自序列化完整源码(boot+factory 的 toString 拼接),供 file:// 下构造 Blob Worker
  // (file:// 禁 new Worker('worker.js'),也读不到外链脚本文本;函数自序列化全浏览器通用)
  if (typeof document !== 'undefined' && root === (typeof window !== 'undefined' ? window : root))
    root.__WORKER_SRC = '(' + boot.toString() + ')(self,' + factory.toString() + ');';
  if (typeof self !== 'undefined' && typeof self.onmessage !== 'undefined' &&
      typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    self.onmessage = function (e) {
      var msg = e.data;
      if (msg.cmd === 'scan') api.scanInWorker(msg, self);
    };
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MULT = 0x6C078965;

  function advanceSeed(seed) {
    seed = seed >>> 0;
    var x = (seed ^ (seed >>> 30)) >>> 0;
    var s0 = Math.imul(x, MULT) >>> 0;
    var s1 = (Math.imul(s0 ^ (s0 >>> 30), MULT) + 1) >>> 0;
    var s2 = (Math.imul(s1 ^ (s1 >>> 30), MULT) + 2) >>> 0;
    var s3 = (Math.imul(s2 ^ (s2 >>> 30), MULT) + 3) >>> 0;
    var t = (Math.imul(x, 0x3C4B2800) ^ s0) >>> 0;
    return (t ^ (t >>> 8) ^ s3 ^ (s3 >>> 19)) & 0x7FFFFFFF;
  }

  // 单级决定增益(与 core.levelup 相同的四阶段)
  // lv: {g9:9 成长, gc, cap9} —— 资格按链上 cur 现算(各候选 cur 历史不同!)
  // cur: Int32Array 9(资格判定 + 落地截断);gains9: 输出(复用)
  function simLevel(seed, lv, cur, gains9) {
    var st0, st1, st2, st3, t, nxt;
    seed = seed >>> 0;                                  // mt_init4
    var x = (seed ^ (seed >>> 30)) >>> 0;
    st0 = Math.imul(x, MULT) >>> 0;
    st1 = (Math.imul(st0 ^ (st0 >>> 30), MULT) + 1) >>> 0;
    st2 = (Math.imul(st1 ^ (st1 >>> 30), MULT) + 2) >>> 0;
    st3 = (Math.imul(st2 ^ (st2 >>> 30), MULT) + 3) >>> 0;

    var g9 = lv.g9, cap9 = lv.cap9, gc = lv.gc;
    var stats = lv._stats || (lv._stats = new Int32Array(9));
    var gain = lv._gain || (lv._gain = new Int32Array(9));
    var n = 0;                                          // 资格:g>=1 且 cur<cap
    for (var i = 0; i < 9; i++) {
      if (g9[i] >= 1 && cur[i] < cap9[i]) { stats[n] = i; n++; }
    }
    var rerollT = Math.max(1, Math.min(gc, n)), fillT = Math.min(gc, n);
    var rolls = 0, nz = 0;
    for (var p = 0; p < 4; p++) {                       // 阶段2:掷点 ≤4 轮
      nz = 0;
      for (var k = 0; k < n; k++) {
        var g = g9[stats[k]];
        var base = (g / 100) | 0, res = g % 100, gv;
        if (res === 0) gv = base;                        // 整百不耗 RN
        else {
          t = (st0 ^ (st0 << 11)) >>> 0;                 // xor128 步进
          nxt = (t ^ (t >>> 8) ^ st3 ^ (st3 >>> 19)) >>> 0;
          st0 = st1; st1 = st2; st2 = st3; st3 = nxt;
          gv = base + ((((nxt & 0x7FFFFFFF) % 1000000) < res * 10000) ? 1 : 0);
        }
        gain[stats[k]] = gv;
        if (gv > 0) nz++;
      }
      rolls++;
      if (nz >= rerollT || rolls >= 4) break;
    }
    var deficit = fillT - nz;                           // 阶段3:加权补足
    for (var d = 0; d < deficit; d++) {
      var total = 0;
      for (k = 0; k < n; k++) { var kk = stats[k]; if (gain[kk] === 0) total += g9[kk] * 100; }
      if (total === 0) break;
      t = (st0 ^ (st0 << 11)) >>> 0;
      nxt = (t ^ (t >>> 8) ^ st3 ^ (st3 >>> 19)) >>> 0;
      st0 = st1; st1 = st2; st2 = st3; st3 = nxt;
      var rem = (nxt & 0x7FFFFFFF) % total;
      for (k = 0; k < n; k++) {
        kk = stats[k];
        if (gain[kk] !== 0) continue;
        rem -= g9[kk] * 100;
        if (rem < 0) { gain[kk] = 1; break; }
      }
    }
    for (k = 0; k < 9; k++) gains9[k] = 0;
    for (k = 0; k < n; k++) gains9[stats[k]] = gain[stats[k]];
  }

  // 判定一个种子在给定计划下是否吻合所有观测;返回是否匹配(早退)
  // levels: [lv...](含 skip);observed: [null | Int 数组9];cur0
  function matchSeed(seed, levels, observed, cur0, gains9, cur) {
    for (var j = 0; j < 9; j++) cur[j] = cur0[j];
    for (var i = 0; i < levels.length; i++) {
      var lv = levels[i];
      for (var s = 0; s < lv.skip; s++) seed = advanceSeed(seed);
      simLevel(seed, lv, cur, gains9);
      var ob = observed[i];
      if (ob) {
        for (j = 0; j < 9; j++) if (gains9[j] !== ob[j]) return false;   // 决定增益比较
      }
      var cap9 = lv.cap9;
      for (j = 0; j < 9; j++) {                        // 落地截断后推进 cur
        var add = gains9[j] > 0 ? Math.min(gains9[j], Math.max(0, cap9[j] - cur[j])) : 0;
        cur[j] += add;
      }
      seed = advanceSeed(seed);
    }
    return true;
  }

  // Worker 扫描:msg = {cmd:'scan', levels, observed, cur0, from, to, cap, stopOnFirst, wasm?}
  function scanInWorker(msg, ctx) {
    if (msg.wasm) return scanWasm(msg, ctx);             // 通用高速引擎(.wasm,每个 worker 独立实例)
    var levels = msg.levels, observed = msg.observed, cur0 = msg.cur0;
    var from = msg.from >>> 0, to = msg.to >>> 0, cap = msg.cap || 200000;
    var gains9 = new Int32Array(9), cur = new Int32Array(9);
    var matches = new Uint32Array(cap), m = 0;
    var stop1 = !!msg.stopOnFirst;                       // 观测≥5:命中 1 个即停(主线程会杀掉其余 worker)
    var t0 = Date.now(), lastPost = t0;
    for (var s = from; s <= to; s++) {
      if (matchSeed(s, levels, observed, cur0, gains9, cur)) {
        if (m < cap) matches[m++] = s;
        else { ctx.postMessage({ type: 'overflow' }); break; }
        if (stop1 && m >= 1) break;                      // 首中即停:立即上报 done
      }
      if ((s & 0xFFFFF) === 0) {                       // 每 1M 查一次时间(多级计划吞吐低,不能等 16M 才报)
        var now = Date.now();
        if (now - lastPost > 200) {
          lastPost = now;
          ctx.postMessage({ type: 'progress', done: s - from, total: to - from + 1, matches: m });
        }
      }
    }
    var out = matches.subarray(0, m);
    // 注意发视图 out(长度=命中数)而非 out.buffer:buffer 是整个 cap 上限缓冲区,
    // 主线程若按 buffer 解析会收到几十万个 0 再 push.apply 炸调用栈
    ctx.postMessage({ type: 'done', done: to - from + 1, matches: m,
      seeds: out, truncated: m >= cap }, [out.buffer]);
  }

  // WASM 引擎路径:cfg 布局 = few_engine_wasm.c 的 ABI;分块调用以保持进度/首中即停
  function scanWasm(msg, ctx) {
    WebAssembly.instantiate(msg.wasm, {}).then(function (res) {
      var mod = res.instance.exports;
      var cfg = new Int32Array(mod.memory.buffer, mod.cfg_addr(), 1 + 256 * 30);
      var out = new Uint32Array(mod.memory.buffer, mod.out_addr(), 200001);
      cfg[0] = msg.levels.length;
      msg.levels.forEach(function (l, i) {
        var b = 1 + i * 30, k;
        for (k = 0; k < 9; k++) { cfg[b + k] = l.g9[k] | 0; cfg[b + 9 + k] = l.cap9[k] | 0; }
        cfg[b + 18] = l.gc | 0; cfg[b + 19] = l.skip | 0;
        var ob = msg.observed[i];
        cfg[b + 20] = ob ? 1 : 0;
        if (ob) for (k = 0; k < 9; k++) cfg[b + 21 + k] = ob[k] | 0;
      });
      var from = msg.from >>> 0, to = msg.to >>> 0, cap = msg.cap || 200000, stop1 = !!msg.stopOnFirst;
      var matches = new Uint32Array(cap), m = 0, lastPost = Date.now(), CH = 1 << 22;
      for (var s = from; s <= to; ) {
        var end = (s + CH - 1) > to ? to : (s + CH - 1);
        var n = mod.scan(s, end, stop1 ? 1 : 0) | 0;
        for (var q = 0; q < n && m < cap; q++) matches[m++] = out[q];
        if (n > 0 && (stop1 || n >= 200000)) { if (n >= 200000) ctx.postMessage({ type: 'overflow' }); break; }
        s = end + 1;
        var now = Date.now();
        if (now - lastPost > 200) {
          lastPost = now;
          ctx.postMessage({ type: 'progress', done: s - from, total: to - from + 1, matches: m });
        }
      }
      var o = matches.subarray(0, m);
      ctx.postMessage({ type: 'done', done: to - from + 1, matches: m,
        seeds: o, truncated: m >= cap }, [matches.buffer]);
    }).catch(function () { ctx.postMessage({ type: 'overflow' }); });   // 引擎异常:按候选不全警示
  }

  return { advanceSeed: advanceSeed, simLevel: simLevel, matchSeed: matchSeed, scanInWorker: scanInWorker };
});
