/* core.js — 火纹 Fortunes Weave 加点模拟核心(位精确移植)
 * 来源:prng_work/levelup_sim.py(权威实现)/ LEVELUP_SPEC.md(规格)
 * 移植陷阱已按 PLAN.md §4 处理:乘法一律 Math.imul,u32 边界一律 >>>0
 * 环境:浏览器 file:// 直开(经典脚本,无模块依赖)与 Node require 通用
 */
(function (root, factory) {
  var api = factory();
  root.FECore = api;                       // 浏览器全局 / Node globalThis
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var MULT = 0x6C078965;                   // ★不是标准 MT 的 0x6C078865

  // 属性序 = 引擎序(statId 0..8),由 Person.bin 指纹反证:技速/幸防序与 CSV 展示序不同
  var STATS = ['生命', '力量', '魔力', '技巧', '速度', '幸运', '防御', '魔防', '魅力'];

  function mtInit4(seed) {                // mt_init4 @0x8ce648
    seed = seed >>> 0;
    var x = (seed ^ (seed >>> 30)) >>> 0;
    var s0 = Math.imul(x, MULT) >>> 0;
    var s1 = (Math.imul(s0 ^ (s0 >>> 30), MULT) + 1) >>> 0;
    var s2 = (Math.imul(s1 ^ (s1 >>> 30), MULT) + 2) >>> 0;
    var s3 = (Math.imul(s2 ^ (s2 >>> 30), MULT) + 3) >>> 0;
    return [s0, s1, s2, s3];
  }

  function Xor128(seed) {                 // xor128 @0x8ceaa0,31 位输出
    this.s = mtInit4(seed >>> 0);
    this.draws = 0;
  }
  Xor128.prototype.next = function () {
    var s = this.s, s0 = s[0], s1 = s[1], s2 = s[2], s3 = s[3];
    var t = (s0 ^ (s0 << 11)) >>> 0;
    var nxt = (t ^ (t >>> 8) ^ s3 ^ (s3 >>> 19)) >>> 0;
    s[0] = s1; s[1] = s2; s[2] = s3; s[3] = nxt;
    this.draws++;
    return nxt & 0x7FFFFFFF;
  };

  function advanceSeed(seed) {            // 0x6e2680 尾部,40/40 实测验证
    seed = seed >>> 0;                     // ≡ 引擎第 1 个 RN 原始输出(自检 V5)
    var x = (seed ^ (seed >>> 30)) >>> 0;
    var s0 = Math.imul(x, MULT) >>> 0;
    var s1 = (Math.imul(s0 ^ (s0 >>> 30), MULT) + 1) >>> 0;
    var s2 = (Math.imul(s1 ^ (s1 >>> 30), MULT) + 2) >>> 0;
    var s3 = (Math.imul(s2 ^ (s2 >>> 30), MULT) + 3) >>> 0;
    var t = (Math.imul(x, 0x3C4B2800) ^ s0) >>> 0;
    return (t ^ (t >>> 8) ^ s3 ^ (s3 >>> 19)) & 0x7FFFFFFF;
  }

  function appliedAfterClamp(gains, cur, cap) {   // 应用阶段逐点复查 cur<cap
    var out = new Array(9);
    for (var i = 0; i < 9; i++)
      out[i] = gains[i] > 0 ? Math.min(gains[i], Math.max(0, cap[i] - cur[i])) : 0;
    return out;
  }

  // 主引擎 levelup @0x8ce620(四阶段,细节见 LEVELUP_SPEC §4)
  // trace:可选数组,收集审计日志(与 python 版同格式)
  function levelup(seed, growths, cur, cap, gc, trace) {
    var rng = new Xor128(seed);
    var log = Array.isArray(trace)
      ? function (m) { trace.push(m); } : function () {};

    var L = [];                            // 阶段0:资格(g>=1 且 cur<cap,一次性)
    for (var i = 0; i < 9; i++) {
      var g = growths[i] | 0;
      if (g < 1) continue;
      if (!(cur[i] < cap[i])) { log('资格  stat' + i + ': 排除(当前 ' + cur[i] + ' >= 上限 ' + cap[i] + ')'); continue; }
      L.push([i, g, 0]);                   // [statId, growth, gain]
    }
    var n = L.length;
    var list = [];
    for (var k = 0; k < n; k++) list.push('stat' + L[k][0] + '(g=' + L[k][1] + ')');
    log('资格  入列 ' + n + ' 项: ' + list.join(', '));

    var fillTarget = Math.min(gc, n);      // 阶段1:保底参数
    var rerollTarget = Math.max(1, fillTarget);
    log('保底  gc=' + gc + ' -> 重掷门槛=' + rerollTarget + ', 补足目标=' + fillTarget);

    var rolls = 0, gains5;                 // 阶段2:掷点,最多 4 轮
    while (true) {
      for (k = 0; k < n; k++) L[k][2] = 0;
      rolls++;
      log('—— 第 ' + rolls + ' 轮掷点 ——');
      for (k = 0; k < n; k++) {
        var e = L[k], si = e[0], gg = e[1];
        var base = (gg / 100) | 0, residual = gg % 100;   // g≥1,divmod 安全
        if (residual === 0) {              // ★整百生长不耗 RN
          e[2] = base;
          log('  stat' + si + ': g=' + gg + ' → 保底+' + base + ',残差 0 不耗 RN');
          continue;
        }
        var out = rng.next();
        var rn = out % 1000000;
        var hit = rn < residual * 10000;
        e[2] = base + (hit ? 1 : 0);
        log('  stat' + si + ': g=' + gg + '=' + base + '+' + residual + '%  RN#' +
            rng.draws + '=' + out + '(mod1e6=' + rn + ') ' + (hit ? '<' : '>=') +
            ' ' + residual * 10000 + ' → +' + e[2]);
      }
      var nz = 0;
      for (k = 0; k < n; k++) if (L[k][2] > 0) nz++;
      log('  本轮非零增益 ' + nz + ' 个');
      if (nz >= rerollTarget || rolls >= 4) break;
    }

    var deficit = fillTarget - nz;         // 阶段3:加权补足(每缺 1 点抽 1 RN)
    for (var d = 0; d < Math.max(0, deficit); d++) {
      var cands = [];
      for (k = 0; k < n; k++) if (L[k][2] === 0) cands.push(L[k]);
      if (!cands.length) { log('补足  无零增益候选,空转(不耗 RN)'); break; }
      var total = 0;
      for (k = 0; k < cands.length; k++) total += cands[k][1] * 100;
      var out2 = rng.next();
      var rem = out2 % total;
      var picked = null;
      for (k = 0; k < cands.length; k++) {
        rem -= cands[k][1] * 100;          // 走表:首个变负者中选(rem==0 不选)
        if (rem < 0) { picked = cands[k]; break; }
      }
      picked[2] = 1;
      log('补足  RN#' + rng.draws + '=' + out2 + ' % 总权重' + total +
          ' → 选 stat' + picked[0] + '(权重' + picked[1] * 100 + ') 置 1');
    }

    var result = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (k = 0; k < n; k++) result[L[k][0]] = L[k][2];
    return {
      gains: result,
      applied: appliedAfterClamp(result, cur, cap),
      draws: rng.draws,
      rolls: rolls,
      nextSeed: advanceSeed(seed >>> 0)
    };
  }

  // 事件链(用户实测:升级与转职共用乱数链;转职只消耗一个种子、不加点)
  // steps: [{t:'lv', growths,cur,cap,gc} | {t:'class'}]
  // 'lv' 的 cur 等状态由调用方组装(应用层负责累加);核心只算单级
  function simulateChain(startSeed, steps) {
    var seed = startSeed >>> 0, results = [];
    for (var idx = 0; idx < steps.length; idx++) {
      var st = steps[idx];
      if (st.t === 'class') {
        var after = advanceSeed(seed);
        results.push({ type: 'class', seedBefore: seed, seedAfter: after });
        seed = after;
      } else {
        var r = levelup(seed, st.growths, st.cur, st.cap, st.gc);
        results.push({ type: 'level', seedBefore: seed, seedAfter: r.nextSeed, r: r });
        seed = r.nextSeed;
      }
    }
    return results;
  }

  return {
    STATS: STATS, MULT: MULT,
    mtInit4: mtInit4, Xor128: Xor128, advanceSeed: advanceSeed,
    levelup: levelup, appliedAfterClamp: appliedAfterClamp,
    simulateChain: simulateChain
  };
});
