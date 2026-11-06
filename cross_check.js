/* cross_check.js — worker 匹配器与 core.levelup 逐位一致性验证
 * 运行:node cross_check.js
 */
'use strict';
var C = require('./core.js');
var W = require('./worker.js');

function mkLevel(growths, cur, cap, gc) {
  return { g9: growths.slice(), gc: gc, cap9: cap.slice() };  // 资格由匹配器内部按 cur 现算
}

var fails = 0, total = 0;
function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

// 随机场景 × 随机种子:worker.simLevel 的决定增益 == core.levelup 的决定增益
for (var t = 0; t < 20000; t++) {
  var growths = [], cur = [], cap = [];
  for (var i = 0; i < 9; i++) {
    growths.push(rnd(0, 130) === 0 ? 0 : rnd(1, 130));   // 少量 0 生长
    if (Math.random() < 0.08) growths[i] = rnd(95, 205); // 高成长/整百分支
    cur.push(rnd(0, 25));
    cap.push(Math.random() < 0.1 ? cur[i] : rnd(cur[i], 60));  // 10% 已达上限
  }
  var gc = rnd(0, 5);
  var seed = (Math.random() * 4294967296) >>> 0;
  var lv = mkLevel(growths, cur, cap, gc);
  var g9 = new Int32Array(9);
  W.simLevel(seed, lv, cur, g9);
  var ref = C.levelup(seed, growths, cur, cap, gc);
  total++;
  var ok = true;
  for (i = 0; i < 9; i++) if (g9[i] !== ref.gains[i]) { ok = false; break; }
  if (!ok) {
    fails++;
    if (fails <= 3) console.log('MISMATCH', { seed: seed, growths: growths, cur: cur, cap: cap, gc: gc, worker: Array.from(g9), core: ref.gains });
  }
}
console.log('simLevel 一致性: ' + (total - fails) + '/' + total + (fails ? '  ✗ 存在不一致!' : '  ✓'));

// matchSeed:计划级(含 skip/cur 携带)回验 —— 构造真种子链,"真种子必须匹配"
var strictFails = 0;
for (t = 0; t < 2000; t++) {
  var L2 = rnd(1, 4), s0 = (Math.random() * 4294967296) >>> 0, sTrue = s0;
  var levels2 = [], obs2 = [], c0 = [];
  for (i = 0; i < 9; i++) c0.push(rnd(5, 20));
  var cW = c0.slice();
  for (var l = 0; l < L2; l++) {
    var gr2 = [], cp2 = [];
    for (i = 0; i < 9; i++) { gr2.push(rnd(1, 120)); cp2.push(rnd(cW[i], 70)); }
    var gc2 = rnd(0, 5), sk2 = rnd(0, 2);
    levels2.push(Object.assign(mkLevel(gr2, cW, cp2, gc2), { skip: sk2 }));
    for (i = 0; i < sk2; i++) sTrue = W.advanceSeed(sTrue);
    var r2 = C.levelup(sTrue, gr2, cW, cp2, gc2);
    obs2.push(r2.gains.slice());
    for (i = 0; i < 9; i++) cW[i] += r2.applied[i];
    sTrue = W.advanceSeed(sTrue);
  }
  var g9b = new Int32Array(9), cWb = new Int32Array(9);
  if (!W.matchSeed(s0, levels2, obs2, c0, g9b, cWb)) strictFails++;
}
console.log('matchSeed 真种子回验: ' + (2000 - strictFails) + '/2000 ' + (strictFails ? '✗' : '✓'));
process.exit(fails || strictFails ? 1 : 0);
