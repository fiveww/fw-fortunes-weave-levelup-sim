/* test_load.js — 启动/存档恢复逻辑回归(Node,DOM 打桩;core/selftest 用真实现)
 * 覆盖:全新状态自动载入第一人物(不再需要切换);旧存档好感 1→5 一次性迁移;
 *       旧存档无 personId 时按成长率指纹找回;存档不覆盖 presets.js 新数据;
 *       预设始终以 presets.js 为准;预测从观测最低等级列到99级
 * 运行:node test_load.js
 */
'use strict';
var fs = require('fs'), vm = require('vm'), path = require('path');
var SRC = ['presets.js', 'core.js', 'worker.js', 'selftest.js', 'app.js']
  .reduce(function (o, f) { o[f] = fs.readFileSync(path.join(__dirname, f), 'utf8'); return o; }, {});
var LS = 'few_sim_v11';

function mkEl() {
  return { innerHTML: '', value: '', textContent: '', style: {}, disabled: false,
    onclick: null, onchange: null,
    // [data-k] 从 innerHTML 解析并缓存(同一份 HTML 返回同一批元素,保留 renderPlan 绑的 onchange)
    querySelectorAll: function (sel) {
      if (sel !== '[data-k]' || !this.innerHTML) return [];
      if (this._dkFor !== this.innerHTML) {
        var out = [], re = /<(input|select)\b[^>]*?\bdata-r="(\d+)"[^>]*?\bdata-k="([a-z]+)"/g, m;
        while ((m = re.exec(this.innerHTML))) out.push({ dataset: { r: m[2], k: m[3] }, value: '', onchange: null });
        this._dk = out; this._dkFor = this.innerHTML;
      }
      return this._dk;
    } };
}
function boot(seedStorage) {                        // 返回 {sandbox, read, presets}
  var store = {}, els = {};
  if (seedStorage) Object.keys(seedStorage).forEach(function (k) { store[k] = seedStorage[k]; });
  var sandbox = {
    console: console, setTimeout: function () {}, navigator: {}, confirm: function () { return true; },
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); }
    },
    document: {
      getElementById: function (id) { return els[id] || (els[id] = mkEl()); },
      querySelectorAll: function () { return []; },
      createElement: function () { return { href: '', click: function () {} }; }
    },
    alert: function (m) { sandbox._alerts.push(String(m)); },
    _alerts: [], _els: els
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  var ctx = vm.createContext(sandbox);
  Object.keys(SRC).forEach(function (f) { vm.runInContext(SRC[f], ctx, { filename: f }); });
  return {
    sandbox: sandbox,
    read: function () { return JSON.parse(store[LS] || 'null'); },
    presets: vm.runInContext('window.FE_PRESETS', ctx)
  };
}

var fails = 0;
function ck(name, cond, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : '  <<' + JSON.stringify(extra) + '>>'));
  if (!cond) fails++;
}
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// 指纹用例人物:成长率在 73 人里唯一,避免指纹歧义
var REF = boot().presets;
var cnt = {};
REF.persons.forEach(function (p) { var k = p.growths.join(','); cnt[k] = (cnt[k] || 0) + 1; });
var FP = REF.persons.filter(function (p) { return cnt[p.growths.join(',')] === 1 && p.growths.some(function (v) { return v; }); })[0];

console.log('T1 全新状态(无存档):进页面即载入第一人物,好感默认 5;角色卡四行只读');
(function () {
  var b = boot(), s = b.read();
  var ct = b.sandbox._els.charTable.innerHTML;
  ck('自检通过,启动无异常', b.sandbox._els.badge.className === 'ok', b.sandbox._alerts);
  ck('人物下拉回显 p0', b.sandbox._els.personSel.value === 'p0', b.sandbox._els.personSel.value);
  ck('角色成长率=第一人物(非全0)', deepEq(s.personal, REF.persons[0].growths), s.personal);
  ck('默认行好感=5', s.rows[0].bond === 5, s.rows[0].bond);
  ck('personId 已持久化', s.personId === 'p0', s.personId);
  ck('角色卡无"当前值"行、无任何输入框', ct.indexOf('当前值') < 0 && ct.indexOf('<input') < 0, ct.slice(0, 150));
  ck('最终成长率只读展示(无 adj 输入)', ct.indexOf('最终成长率') >= 0 && ct.indexOf('data-f=') < 0, ct.slice(0, 300));
})();

console.log('T2 旧存档(v11 改版前):好感 1→5 迁移;尾部未观测行迁预测区;personId 指纹找回;预设以 presets.js 为准');
(function () {
  var Z = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  var old = {};
  old[LS] = JSON.stringify({
    personal: FP.growths.slice(), adj: Z.slice(), startCur: [15, 6, 4, 7, 7, 5, 4, 3, 2],   // 旧字段,应被忽略
    gcDefault: 2,
    classes: [{ id: 'zz', name: '垃圾旧职业', growths: [1, 1, 1, 1, 1, 1, 1, 1, 1], caps: [1], gc: 9 }],  // 应被忽略
    mounts: [],                                                                                          // 应被忽略
    persons: [{ id: FP.id, name: FP.name, growths: FP.growths.slice(), adj: [1, 2, 0, 0, 3, 0, 0, 0, 4] }],  // 应被忽略
    rows: [
      { skip: 0, cls: 'c0', mount: 'm3', bond: 1, obs: Z.slice() },   // 旧默认好感 1 → 迁移为 5
      { skip: 0, cls: 'c1', mount: 'none', bond: 3, obs: null }       // 尾部未观测行 → 迁到预测区(好感 3 保留)
    ]
  });
  var b = boot(old), s = b.read();
  ck('指纹找回选中人物', b.sandbox._els.personSel.value === FP.id, b.sandbox._els.personSel.value);
  ck('行1 好感迁移 1→5', s.rows[0].bond === 5, s.rows[0].bond);
  ck('尾部未观测行迁预测区(等级2处好感3保留)', s.rows.length === 1 && s.predRows.length === 98 && s.predRows[1].bond === 3,
    [s.predRows.length, s.predRows[1] && s.predRows[1].bond]);
  ck('迁移只做一次(标记持久化)', s.bond5mig === true && s.predMig === true, [s.bond5mig, s.predMig]);
  ck('职业列表取 presets.js(垃圾被忽略)', s.classes.length === REF.classes.length, s.classes.length);
  ck('坐骑列表取 presets.js', s.mounts.length === REF.mounts.length, s.mounts.length);
  ck('人物列表取 presets.js(旧副本/adj 忽略)', s.persons.length === REF.persons.length, s.persons.length);
  ck('adj/startCur 字段被丢弃', s.adj === undefined && s.startCur === undefined, [s.adj, s.startCur]);
  ck('行等级 1,预测从最低等级 1 列起', s.rows[0].lv === 1 && s.predRows[0].lv === 1 && s.predRows[1].lv === 2,
    [s.rows[0].lv, s.predRows[0] && s.predRows[0].lv, s.predRows[1] && s.predRows[1].lv]);
})();

console.log('T3 新版存档回环:personId 回显;手选好感不被初始化冲掉');
(function () {
  var b1 = boot();                                  // 先产生一份新版存档
  var s1 = b1.read();
  s1.rows[0].bond = 3;                                  // 模拟:手动降到好感 3
  var st = {}; st[LS] = JSON.stringify(s1);
  var b2 = boot(st), s2 = b2.read();
  ck('personId 回显', b2.sandbox._els.personSel.value === 'p0', b2.sandbox._els.personSel.value);
  ck('手选好感 3 不被再次迁移', s2.rows[0].bond === 3, s2.rows[0].bond);
})();

console.log('T4 存档 personId 失效(预设删人):按指纹兜底');
(function () {
  var st = {};
  st[LS] = JSON.stringify({ personal: FP.growths.slice(), gcDefault: 2, personId: 'ghost',
    rows: [{ skip: 0, cls: 'c0', mount: 'none', bond: 5, obs: null }] });
  var b = boot(st);
  ck('回退到指纹匹配人物', b.sandbox._els.personSel.value === FP.id, b.sandbox._els.personSel.value);
})();

console.log('T5 删除观测行:只删观测行,中段未记录行保留;删空至少留一行');
(function () {
  function mk(rows) { var st = {}; st[LS] = JSON.stringify({ rows: rows }); return boot(st); }
  var Z = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  var b = mk([{ skip: 0, cls: 'c0', mount: 'none', bond: 5, obs: Z.slice() },
              { skip: 0, cls: 'c1', mount: 'none', bond: 3, obs: null },      // 中段未记录的级(尾部会被迁去预测区)
              { skip: 0, cls: 'c0', mount: 'none', bond: 5, obs: Z.slice() }]);
  b.sandbox._els.clearObs.onclick();
  var s = b.read();
  ck('观测行删掉,中段未记录行保留', s.rows.length === 1 && s.rows[0].obs === null, s.rows.map(function (r) { return !!r.obs; }));
  b = mk([{ skip: 0, cls: 'c0', mount: 'none', bond: 5, obs: Z.slice() }]);  // 全是观测行
  b.sandbox._els.clearObs.onclick();
  s = b.read();
  ck('删空后至少留一行(新行好感=5)', s.rows.length === 1 && s.rows[0].bond === 5, s.rows);
})();

console.log('T6 等级列与列名:等级推算;四个新列名;跳过次数默认 0');
(function () {
  var b = boot(), html = b.sandbox._els.plan.innerHTML;
  ck('默认第 1 行等级=1(显示 X级→X+1级)', b.read().rows[0].lv === 1 && html.indexOf('级→2级') >= 0, html.slice(0, 160));
  ck('新列名齐全', ['升级前的转职跳过次数', '升级时职业', '升级时坐骑', '坐骑好感'].every(function (n) { return html.indexOf(n) >= 0; }),
    html.slice(0, 200));
  ck('转职跳过次数默认 0', b.read().rows[0].skip === 0, b.read().rows[0].skip);
})();

console.log('T7 等级可编辑:新行接续末行;改某行后续顺延;起始等级重排全表');
(function () {
  var b = boot(), els = b.sandbox._els;
  b.sandbox.document.getElementById('addN').value = '2'; els.addRows.onclick();   // +2 行 → 等级 1,2,3
  ck('新行等级接续末行', b.read().rows.map(function (r) { return r.lv; }).join() === '1,2,3',
    b.read().rows.map(function (r) { return r.lv; }));
  var lv1 = els.plan.querySelectorAll('[data-k]').filter(function (e) { return e.dataset.k === 'lv' && e.dataset.r === '1'; })[0];
  lv1.value = '10'; lv1.onchange();                             // 第 2 行改 10 → 后续顺延 10,11
  ck('改第2行=10,后续顺延', b.read().rows.map(function (r) { return r.lv; }).join() === '1,10,11',
    b.read().rows.map(function (r) { return r.lv; }));
  els.startLv.value = '5'; els.startLv.onchange();              // 起始等级 5 → 全表 5,6,7
  var s = b.read();
  ck('起始等级重排全表', s.startLv === 5 && s.rows.map(function (r) { return r.lv; }).join() === '5,6,7',
    s.rows.map(function (r) { return r.lv; }));
  ck('第 1 行 value=5 显示 级→6级', els.plan.innerHTML.indexOf('value="5">级→6级') >= 0 && els.plan.innerHTML.indexOf('级→7级') >= 0,
    els.plan.innerHTML.slice(160, 400));
  var lv0 = els.plan.querySelectorAll('[data-k]').filter(function (e) { return e.dataset.k === 'lv' && e.dataset.r === '0'; })[0];
  lv0.value = '0'; lv0.onchange();                              // 非法输入钳到 1
  ck('等级输入最小钳 1', b.read().rows[0].lv === 1, b.read().rows[0].lv);
})();

console.log('T9 观测/预测分区:预测从观测最低等级列到99级;镜像只读;未来段传播;观测变动同步');
(function () {
  var b = boot(), els = b.sandbox._els, doc = b.sandbox.document;
  ck('观测表不再有预测/种子列', els.plan.innerHTML.indexOf('data-pred') < 0 && els.plan.innerHTML.indexOf('种子(前→后)') < 0,
    els.plan.innerHTML.slice(0, 260));
  var s = b.read();
  ck('预测行自动生成 98 行(1→99 级)', s.predRows.length === 98, s.predRows.length);
  ck('预测首行=观测最低等级(1级)', s.predRows[0].lv === 1 && s.predRows[1].lv === 2, [s.predRows[0].lv, s.predRows[1].lv]);
  doc.getElementById('knownSeed').value = '123456789';
  els.knownRun.onclick();
  var pt = els.predTable.innerHTML;
  ck('预测表含加点与种子列', pt.indexOf('预测加点') >= 0 && pt.indexOf('class="g9"') >= 0 && pt.indexOf('升级所用种子') >= 0, pt.slice(0, 120));
  var ks = els.predTable.querySelectorAll('[data-k]');
  ck('预测区所有行可编辑(第1行即有控件)', ks.length > 0 && Math.min.apply(null, ks.map(function (e) { return +e.dataset.r; })) === 0, ks.length);
  var sel = ks.filter(function (e) { return e.dataset.k === 'cls' && e.dataset.r === '3'; })[0];
  sel.value = 'c5'; sel.onchange();                        // 未来段第4行改职业 → 向后传播
  s = b.read();
  ck('未来段职业向后传播', s.predRows.slice(3).every(function (r) { return r.cls === 'c5'; }) && s.predRows[2].cls !== 'c5',
    s.predRows.slice(0, 5).map(function (r) { return r.cls; }));
  var C = require('./core.js');
  var r1 = C.levelup(123456789, s.personal, [0, 0, 0, 0, 0, 0, 0, 0, 0], [99, 99, 99, 99, 99, 99, 99, 99, 99], s.gcDefault);   // 预测首行=第1级
  var ptNow = els.predTable.innerHTML;
  var disp = [0, 1, 2, 4, 3, 6, 7, 5, 8].map(function (e) { return r1.gains[e]; });   // 0 渲染为 <b class="z">0</b>
  ck('预测首行加点=core 直算值', disp.every(function (v) { return v === 0 ? ptNow.indexOf('class="z">0</b>') >= 0 : ptNow.indexOf('<b>' + v + '</b>') >= 0; }), disp.join(','));
  doc.getElementById('addN').value = '2'; els.addRows.onclick();   // 观测加 2 行 → 镜像 3 行
  s = b.read();
  ck('观测加行→镜像3行,未来仍列到98(共98)', s.rows.length === 3 && s.predRows.length === 98 && s.predRows[0].lv === 1,
    [s.rows.length, s.predRows.length]);
  ck('未来配置按等级保留(4级仍 c5)', s.predRows[3].lv === 4 && s.predRows[3].cls === 'c5', [s.predRows[3].lv, s.predRows[3].cls]);
  doc.getElementById('startLv').value = '5'; doc.getElementById('startLv').onchange();   // 从 5 级开始列
  s = b.read();
  ck('起始等级5→预测从5级列到98(94行)', s.predRows[0].lv === 5 && s.predRows.length === 94,
    [s.predRows[0].lv, s.predRows.length]);
})();

console.log('T10 通用引擎与候选持久化:引擎文件长期记忆;候选随存档保存');
(function () {
  var b = boot(), els = b.sandbox._els;
  ck('默认未启用引擎', els.engineStat.textContent.indexOf('未启用') >= 0, els.engineStat.textContent);
  var st = JSON.parse(JSON.stringify(b.read()));
  var all = {}; all[LS] = JSON.stringify(st); all['few_wasm_engine'] = 'AAAA';   // 假引擎 base64,验证存取链路
  var b2 = boot(all), els2 = b2.sandbox._els;
  ck('引擎随 localStorage 长期记忆', els2.engineStat.textContent.indexOf('已启用') >= 0, els2.engineStat.textContent);
  els2.engineOff.onclick();
  ck('停用后清除', els2.engineStat.textContent.indexOf('未启用') >= 0, els2.engineStat.textContent);
  var s = b2.read();
  s.candidates = [123456789, 987654321];
  var st3 = {}; st3[LS] = JSON.stringify(s);
  var b3 = boot(st3), s3 = b3.read();
  ck('候选随存档长期保存', deepEq(s3.candidates, [123456789, 987654321]), s3.candidates);
  ck('候选界面恢复且预测出表', b3.sandbox._els.candSummary.textContent.indexOf('候选种子:2 个') >= 0 &&
    b3.sandbox._els.predTable.innerHTML.indexOf('升级所用种子') >= 0, b3.sandbox._els.candSummary.textContent);
})();


console.log('T11 结构完整性:app.js 引用的元素 id 全部存在于 index.html');
(function () {
  var app = SRC['app.js'], html = require('fs').readFileSync(__dirname + '/index.html', 'utf8');
  var ids = {}, re = /el\('([A-Za-z0-9_]+)'\)/g, m;
  while ((m = re.exec(app))) ids[m[1]] = 1;
  var missing = Object.keys(ids).filter(function (id) { return html.indexOf('id="' + id + '"') < 0; });
  ck('无悬空元素引用(' + Object.keys(ids).length + ' 个 id)', missing.length === 0, missing);
})();


console.log('T12 重置:清观测/候选/人物回初始,预测区重建,引擎保留');
(function () {
  var Z = [0,0,0,0,0,0,0,0,0];
  var all = {};
  all[LS] = JSON.stringify({ personId: 'p3', gcDefault: 2,
    rows: [{ skip: 1, cls: 'c2', mount: 'm3', bond: 3, lv: 7, obs: Z.slice() }],
    predRows: [{ skip: 0, cls: 'c2', mount: 'none', bond: 5, lv: 8 }],
    candidates: [11, 22] });
  all['few_wasm_engine'] = 'AAAA';
  var b = boot(all), els = b.sandbox._els;
  ck('重置前有候选', els.candSummary.textContent.indexOf('候选种子:2 个') >= 0, els.candSummary.textContent);
  ck('重置前人物 p3', els.personSel.value === 'p3', els.personSel.value);
  els.resetBtn.onclick();
  var s = b.read();
  ck('观测回 1 行默认(好感5/等级1)', s.rows.length === 1 && s.rows[0].bond === 5 && s.rows[0].lv === 1, s.rows);
  ck('候选与已知种子清空', (s.candidates === null || s.candidates === undefined) && b.sandbox._els.knownSeed.value === '', s.candidates);
  ck('预测区重建 98 行', s.predRows.length === 98, s.predRows.length);
  ck('引擎保留(仍已启用)', els.engineStat.textContent.indexOf('已启用') >= 0, els.engineStat.textContent);
})();

console.log(fails ? 'FAIL ' + fails : 'ALL PASS');
process.exit(fails ? 1 : 0);
