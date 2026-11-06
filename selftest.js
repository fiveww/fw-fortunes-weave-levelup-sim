/* selftest.js — 黄金向量自检(V0-V6 + 转职链规则),浏览器与 Node 通用
 * 向量来源:LEVELUP_SPEC.md §9(由反汇编移植的 python 参考实现生成)
 */
(function (root, factory) {
  root.FESelftest = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var V1_IN = {
    growths: [120, 45, 35, 50, 55, 100, 25, 20, 0],
    cur: [30, 12, 8, 14, 15, 10, 9, 6, 3],
    cap: [60, 20, 20, 25, 24, 30, 20, 6, 10]
  };
  var V1_RN26 = [653244981, 655648930, 1303942347, 1246984643, 288771246, 358840146,
    485799929, 1295534277, 1850224368, 1612651916, 1508717833, 1444683921,
    2030873356, 1642543836, 1368530580, 1723708575, 2054502287, 580703175,
    1673207742, 1755928090, 1001639375, 2146771861, 1149797690, 1714623031,
    1129014923, 359927036];

  function build(C) {                      // C = FECore
    var T = [];
    function chk(name, got, want) {
      T.push({ name: name, pass: JSON.stringify(got) === JSON.stringify(want), got: got, want: want });
    }

    // V0 初始化
    chk('V0 mtInit4(90)', C.mtInit4(90).map(function (v) { return v >>> 0; }),
      [0xFAA64D82, 0x6D9D9CE6, 0x56778625, 0xEEED3037]);

    // V1 全分支(seed=90, gc=4)
    var r1 = C.levelup(90, V1_IN.growths, V1_IN.cur, V1_IN.cap, 4);
    chk('V1 决定增益', r1.gains, [1, 0, 1, 1, 0, 1, 0, 0, 0]);
    chk('V1 落地增益', r1.applied, [1, 0, 1, 1, 0, 1, 0, 0, 0]);
    chk('V1 RN 总耗', r1.draws, 26);
    chk('V1 新种子', r1.nextSeed, 653244981);
    var rng = new C.Xor128(90), stream = [];
    for (var i = 0; i < 26; i++) stream.push(rng.next());
    chk('V1 RN 原始流(26)', stream, V1_RN26);

    // V2 单轮即停(seed=1, gc=0)
    var r2 = C.levelup(1, V1_IN.growths, V1_IN.cur, V1_IN.cap, 0);
    chk('V2 决定增益', r2.gains, [1, 0, 0, 1, 0, 1, 0, 0, 0]);
    chk('V2 RN 总耗', r2.draws, 6);
    chk('V2 新种子', r2.nextSeed, 128212549);

    // V3 全排除(seed=12345, gc=3, 生长全 0)
    var r3 = C.levelup(12345, [0, 0, 0, 0, 0, 0, 0, 0, 0], V1_IN.cur, V1_IN.cap, 3);
    chk('V3 全零增益', r3.gains, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
    chk('V3 RN 总耗', r3.draws, 0);
    chk('V3 新种子', r3.nextSeed, 859899650);

    // V4 整百生长(seed=7, gc=0)
    var r4 = C.levelup(7, [200, 250, 0, 0, 0, 0, 0, 0, 0], [5, 5, 0, 0, 0, 0, 0, 0, 0],
      [20, 20, 1, 1, 1, 1, 1, 1, 1], 0);
    chk('V4 决定增益', r4.gains, [2, 2, 0, 0, 0, 0, 0, 0, 0]);
    chk('V4 RN 总耗', r4.draws, 1);
    chk('V4 新种子(=RN#1 原始值)', r4.nextSeed, 1581665942);

    // V5 advance ≡ 首个 RN 原始输出
    var v5 = [[0, 1900725608], [1, 128212549], [90, 653244981], [987591, 1063390380],
      [0x7FFFFFFF, 1507036647], [0xDEADBEEF, 676808145], [0x12345678, 2049119678]];
    for (i = 0; i < v5.length; i++) {
      var first = new C.Xor128(v5[i][0]).next();
      chk('V5 s=' + v5[i][0] + ' advance==首RN', [C.advanceSeed(v5[i][0]), first],
        [v5[i][1], v5[i][1]]);
    }

    // V6 连升三级(seed=90, gc=3,cur 逐级累加并截断)
    var exp6 = [
      [[1, 0, 1, 0, 0, 1, 0, 0, 0], 12, 653244981],
      [[1, 0, 0, 0, 0, 1, 1, 0, 0], 6, 1254247836],
      [[1, 1, 0, 0, 0, 1, 0, 0, 0], 6, 265885956]
    ];
    var cur6 = V1_IN.cur.slice(), s6 = 90;
    for (i = 0; i < 3; i++) {
      var r = C.levelup(s6, V1_IN.growths, cur6, V1_IN.cap, 3);
      var ap = r.applied;
      chk('V6 Lv' + (i + 1), [r.gains, ap, r.draws, r.nextSeed], [exp6[i][0], exp6[i][0], exp6[i][1], exp6[i][2]]);
      s6 = r.nextSeed;
      for (var j = 0; j < 9; j++) cur6[j] += ap[j];
    }

    // V9 转职消耗种子(用户实测规则):升1级→转职→再升1级,
    // 第二级必须用 advance(advance(s)) 而非 advance(s)
    var G = [80, 50, 40, 45, 55, 35, 30, 25, 15], CUR = [20, 10, 8, 12, 12, 9, 8, 6, 3],
        CAP = [60, 25, 22, 28, 26, 30, 24, 20, 28];
    var chain = C.simulateChain(90, [
      { t: 'lv', growths: G, cur: CUR, cap: CAP, gc: 2 },
      { t: 'class' },
      { t: 'lv', growths: G, cur: CUR, cap: CAP, gc: 2 }
    ]);
    chk('V9 转职后种子=跳一级', chain[1].seedAfter, C.advanceSeed(C.advanceSeed(90)));
    chk('V9 转职不加点', chain[1].type === 'class' && chain[1].r === undefined, true);
    var direct = C.levelup(C.advanceSeed(C.advanceSeed(90)), G, CUR, CAP, 2);
    chk('V9 第二级结果=直接以种子3模拟', chain[2].r.gains, direct.gains);

    return T;
  }

  return { build: build, run: function (C) {
    var T = build(C), pass = 0;
    for (var i = 0; i < T.length; i++) if (T[i].pass) pass++;
    return { tests: T, pass: pass, total: T.length };
  } };
});

/* Node CLI:node selftest.js */
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  var C = require('./core.js');
  var r = module.exports.run(C);
  for (var i = 0; i < r.tests.length; i++) {
    var t = r.tests[i];
    console.log((t.pass ? 'PASS' : 'FAIL') + '  ' + t.name +
      (t.pass ? '' : '  got=' + JSON.stringify(t.got) + ' want=' + JSON.stringify(t.want)));
  }
  console.log('\n' + (r.pass === r.total ? '全部通过' : '存在失败!') +
    ' ' + r.pass + '/' + r.total);
  process.exit(r.pass === r.total ? 0 : 1);
}
