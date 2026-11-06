/* app.js v2 — 观测反推种子工作流
 * 核心:FECore(权威算法)/ FEWorkerMatch(扫描匹配器,cross_check 验证与 core 位一致)
 * 多线程三层策略(全平台):①http(s) 直连 worker.js(手机/托管必走)②file:// 直开用
 * Blob Worker(worker.js 页面环境下经 document.currentScript 捕获自身源码)③无 Worker 的
 * 老浏览器回退主线程分片扫描
 */
(function () {
  'use strict';
  var C = window.FECore, M = window.FEWorkerMatch, STATS = C.STATS;
  // 显示序(用户约定):生命/力量/魔力/速度/技巧/防御/魔防/幸运/魅力
  // DISP[i] = 第 i 个显示位对应的引擎 statId;内部数组一律引擎序,仅渲染时换序
  var DISP = [0, 1, 2, 4, 3, 6, 7, 5, 8];
  var ZERO9 = [0, 0, 0, 0, 0, 0, 0, 0, 0];            // 基础当前值(当前值行已移除,种子链从 0 起算)
  var LS = 'few_sim_v11';              // v11:角色卡五行人选/职选/骑选合并;旧存档弃用
  var el = function (id) { return document.getElementById(id); };
  // 属性名条(显示序):与加点观测按钮/预测数字同 g9 网格几何,逐列对齐;同用 DISP,不会错位
  var HEAD9 = '<div class="g9 g9h">' + DISP.map(function (e) { return '<span>' + STATS[e] + '</span>'; }).join('') + '</div>';

  // ---------- 状态 ----------
  function defaults() {
    var P = typeof window !== 'undefined' && window.FE_PRESETS;   // 自动生成的预设(presets.js)
    return {
      personal: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      gcDefault: 2,
      startLv: 1,                          // 起始等级:计划表第 1 行 = startLv → startLv+1
      personId: '',                        // 选中的人物(进页面回显并载入)
      predRows: [],                        // 预测区行(独立于观测行;沿用行结构 cls/mount/bond/skip/lv)
      predMig: false,                      // 旧存档"尾部未观测行→预测区"一次性迁移标记
      bond5mig: false,                     // 好感默认 5 迁移标记(存档带回,防止反复改)
      classes: P ? JSON.parse(JSON.stringify(P.classes))
        : [{ id: 'c0', name: '示例职业', growths: [45, 35, 25, 40, 40, 30, 25, 20, 0], caps: [60, 25, 22, 28, 26, 30, 24, 20, 20], gc: 0 }],
      persons: P ? JSON.parse(JSON.stringify(P.persons)) : [],
      mounts: P && P.mounts ? JSON.parse(JSON.stringify(P.mounts)) : [],
      rows: [],
      candidates: null            // null=未过滤;[] 空匹配;[...] 候选
    };
  }
  var S = defaults(), hadSave = false;
  try {
    var saved = JSON.parse(localStorage.getItem(LS) || 'null');
    if (saved) {
      hadSave = true;
      // 预设(职业/坐骑/人物)始终以 presets.js 为准,存档只带回运行状态
      // (adj/startCur 手调已随"当前值行/最终成长率可编辑"一并移除,旧存档里的这些字段直接忽略)
      ['personal', 'gcDefault', 'startLv', 'personId', 'bond5mig', 'predMig', 'rows', 'predRows', 'candidates'].forEach(function (k) {
        if (saved[k] !== undefined) S[k] = saved[k];
      });
    }
  } catch (e) { /* 存档损坏 → 全新状态 */ }
  if (!S.classes.length) S.classes = defaults().classes;
  if (!S.rows.length) S.rows = [newRow()];               // 默认 1 行,按需添加
  if (!S.bond5mig) {                                     // 一次性迁移:旧默认好感 1 → 新默认 5
    S.rows.forEach(function (r) { if ((r.bond | 0) === 1) r.bond = 5; });
    S.bond5mig = true; save();
  }
  S.rows.forEach(function (r, i) { if (r.lv == null) r.lv = Math.max(1, S.startLv | 0) + i; });  // 旧存档行补等级记录
  if (!S.predMig) {                                     // 一次性:旧版把预测行放计划表末尾(obs=null),迁到独立预测区
    var kEnd = S.rows.length;
    while (kEnd > 1 && !S.rows[kEnd - 1].obs) kEnd--;   // 尾部连续未观测行(观测区至少留 1 行)
    var moved = S.rows.slice(kEnd).map(function (r) {
      return { skip: r.skip | 0, cls: r.cls, mount: r.mount, bond: r.bond, lv: r.lv | 0 };
    });
    S.predRows = moved.concat(S.predRows || []);
    S.rows = S.rows.slice(0, kEnd);
    S.predMig = true; save();
  }
  if (!S.predRows) S.predRows = [];
  syncPredRows();                                       // 预测区 = 观测段镜像 + 未来段到 98→99 级
  function save() {
    try {                                                   // 个别环境 localStorage 只读/禁用(隐私模式等)
      var keep = Object.assign({}, S);
      if (!keep.candidates || keep.candidates.length > 5000) delete keep.candidates;   // 候选 ≤5000 长期保存(C 导入/首中即停结果)
      localStorage.setItem(LS, JSON.stringify(keep));
    } catch (e) { /* 存不了就只留内存态 */ }
  }
  function newRow() { return { skip: 0, cls: 'c0', mount: 'none', bond: 5, lv: Math.max(1, S.startLv | 0), obs: [0, 0, 0, 0, 0, 0, 0, 0, 0] }; }  // 观测默认启用(全0);好感默认 5;等级=起始等级(可改,显示 X级→X+1级)
  function lastObsLv() { var r = S.rows[S.rows.length - 1]; return r ? (r.lv | 0) : Math.max(1, S.startLv | 0); }
  function syncPredRows() {                             // 预测区:行集=观测各级+未来到 98→99 级;配置一律按等级保留
    var prev = {};                                      // (所有行可编辑:观测段默认继承观测行,改动不会被观测变动冲掉)
    S.predRows.forEach(function (r) { prev[r.lv | 0] = r; });
    var out = S.rows.map(function (r) {
      var p = prev[r.lv | 0] || r;
      return { skip: p.skip | 0, cls: p.cls, mount: p.mount, bond: p.bond, lv: r.lv | 0 };
    });
    var lv = lastObsLv(), last = S.rows[S.rows.length - 1];
    while (lv < 98 && last) {
      lv++;
      var p = prev[lv] || last;
      out.push({ skip: p.skip | 0, cls: p.cls, mount: p.mount, bond: p.bond, lv: lv });
    }
    S.predRows = out;
  }
  function preset(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function mountG(p, bond) { return p && p.levels ? (p.levels[(bond | 0) - 1] || [0, 0, 0, 0, 0, 0, 0, 0, 0]) : [0, 0, 0, 0, 0, 0, 0, 0, 0]; }
  function rowGrowth(row) {
    var cp = preset(S.classes, row.cls) || S.classes[0];
    var mg = mountG(preset(S.mounts, row.mount), row.bond);
    var m = cp.mountX2 ? 2 : 1;            // 战车系:坐骑成长×2(用户实测规则)
    var g = [];
    for (var i = 0; i < 9; i++) g.push((S.personal[i] | 0) + (cp.growths[i] | 0) + (mg[i] | 0) * m);
    return g;
  }
  function rowCaps(row) { return (preset(S.classes, row.cls) || S.classes[0]).caps.map(function (v) { return v | 0; }); }
  function rowGc(row) { var cp = preset(S.classes, row.cls) || S.classes[0]; return cp.gc > 0 ? cp.gc : (S.gcDefault | 0); }
  function parseSeed(t) { var v = t.trim() ? Number(t.trim()) : NaN; return isNaN(v) ? null : v >>> 0; }

  // ---------- 左列:角色 ----------
  function renderChar() {
    var t = el('charTable');
    var h = '<tr><th></th>' + DISP.map(function (e) { return '<th>' + STATS[e] + '</th>'; }).join('') + '</tr>';
    var row = S.rows[0] || newRow();
    var cp = preset(S.classes, row.cls) || S.classes[0];
    var mg = mountG(preset(S.mounts, row.mount), row.bond);
    var x2 = cp.mountX2 ? 2 : 1;
    function roRow(label, arr) {                     // 只读行
      return '<tr><td>' + label + '</td>' + DISP.map(function (e) {
        return '<td>' + arr[e] + '</td>';
      }).join('') + '</tr>';
    }
    h += roRow('角色成长率', S.personal);
    h += roRow('职业成长率', cp.growths);
    h += roRow('坐骑成长率' + (x2 === 2 ? '×2' : ''), mg.map(function (v) { return v * x2; }));
    var fin = rowGrowth(row);
    h += roRow('最终成长率', fin);                     // 固定合成值,不可改
    t.innerHTML = h;
    el('gcDefault').value = S.gcDefault;
  }
  // ---------- 左列:人物预设 ----------
  function renderPersons() {
    var sel = el('personSel');
    if (!S.persons || !S.persons.length) {
      sel.innerHTML = '<option value="">(无预设,手填人物成长)</option>'; return;
    }
    sel.innerHTML = S.persons.map(function (p) {
      var filled = p.growths.some(function (v) { return v; });
      return '<option value="' + p.id + '">' + p.name + (filled ? '' : '(值待填)') + '</option>';
    }).join('');
  }
  function applyPerson() {
    var p = preset(S.persons, el('personSel').value);
    if (!p) return;
    S.personId = p.id;                                          // 记住选中人物(进页面回显)
    S.personal = p.growths.slice();                             // 人物成长(锁定)
    save(); renderChar(); refreshPredictions();
  }
  el('personSel').onchange = applyPerson;            // 选中即导入

  // 职业预设:数据锁定,无编辑逻辑(计划表内下拉选择)

  // ---------- 角色面板:职业/坐骑/好感全局选择(=第1行配置,改变应用到全部行) ----------
  function renderCharSelectors() {
    var row0 = S.rows[0] || newRow();
    var cs = el('charClsSel');
    cs.innerHTML = S.classes.map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === row0.cls ? ' selected' : '') + '>' + p.name + '</option>';
    }).join('');
    var ms = el('charMntSel');
    ms.innerHTML = '<option value="none"' + (row0.mount === 'none' ? ' selected' : '') + '>步行(无坐骑)</option>' +
      S.mounts.map(function (p) { return '<option value="' + p.id + '"' + (p.id === row0.mount ? ' selected' : '') + '>' + p.name + '</option>'; }).join('');
    var bs = el('charBondSel');
    bs.innerHTML = [1, 2, 3, 4, 5].map(function (b) {
      return '<option' + (b === (row0.bond | 0) ? ' selected' : '') + '>' + b + '</option>';
    }).join('');
  }
  el('charClsSel').onchange = function () {
    S.rows.forEach(function (r) { r.cls = el('charClsSel').value; });
    S.predRows.forEach(function (r) { r.cls = el('charClsSel').value; });   // 预测区同改
    save(); renderPlan(); renderCharSelectors(); renderChar();
  };
  el('charMntSel').onchange = function () {
    S.rows.forEach(function (r) { r.mount = el('charMntSel').value; });
    S.predRows.forEach(function (r) { r.mount = el('charMntSel').value; });
    save(); renderPlan(); renderCharSelectors(); renderChar();
  };
  el('charBondSel').onchange = function () {
    S.rows.forEach(function (r) { r.bond = +(el('charBondSel').value); });
    S.predRows.forEach(function (r) { r.bond = +(el('charBondSel').value); });
    save(); renderPlan(); renderCharSelectors(); renderChar();
  };

  // ---------- 等级计划表 ----------
  function renderPlan() {
    syncPredRows();                                    // 观测行任何变动都先同步预测区(镜像观测段+未来段到99级)
    var t = el('plan');
    var lv0 = Math.max(1, S.startLv | 0);
    var h = '<tr><th>等级</th><th>升级前的转职跳过次数</th><th>升级时职业</th><th>升级时坐骑</th><th>坐骑好感</th><th>观测</th><th title="点击 0↔1;右键/Shift=+2(成长≥100 时出现)">加点观测' + HEAD9 + '</th><th></th></tr>';
    S.rows.forEach(function (r, i) {
      var obsHtml;
      if (r.obs) {
        var cells = '';
        for (var dj = 0; dj < 9; dj++) {
          var j = DISP[dj];                                  // 显示位 → 引擎 statId
          var v = r.obs[j] | 0;
          cells += '<button class="obBtn' + (v === 1 ? ' on1' : v >= 2 ? ' on2' : '') +
            '" data-r="' + i + '" data-j="' + j + '">' + v + '</button>';
        }
        obsHtml = '<div class="g9">' + cells + '</div>';
      } else {
        obsHtml = '<span style="color:var(--dim)">未观测</span>';
      }
      h += '<tr data-row="' + i + '">' +
        '<td style="padding:0;font-size:13px;color:var(--dim)"><input class="no" data-r="' + i + '" data-k="lv" type="number" min="1" value="' + (r.lv | 0) + '">级→' + ((r.lv | 0) + 1) + '级</td>' +
        '<td style="padding:0"><input class="no" data-r="' + i + '" data-k="skip" value="' + r.skip + '"></td>' +
        '<td style="padding:0"><select data-r="' + i + '" data-k="cls">' + S.classes.map(function (p) { return '<option value="' + p.id + '"' + (p.id === r.cls ? ' selected' : '') + '>' + p.name + '</option>'; }).join('') + '</select></td>' +
        '<td style="padding:0"><select data-r="' + i + '" data-k="mount"><option value="none"' + (r.mount === 'none' ? ' selected' : '') + '>步行</option>' + S.mounts.map(function (p) { return '<option value="' + p.id + '"' + (p.id === r.mount ? ' selected' : '') + '>' + p.name + '</option>'; }).join('') + '</select></td>' +
        '<td style="padding:0"><select data-r="' + i + '" data-k="bond">' + [1, 2, 3, 4, 5].map(function (b) { return '<option' + (b === (r.bond | 0) ? ' selected' : '') + '>' + b + '</option>'; }).join('') + '</select></td>' +
        '<td style="padding:0"><button class="btn sec mini obRowBtn' + (r.obs ? ' active' : '') + '" data-obrow="' + i + '">' + (r.obs ? '✓观测' : '观测') + '</button></td>' +
        '<td style="padding:0" colspan="1">' + obsHtml + '</td>' +
        '<td><button class="btn sec mini" data-del="' + i + '">✕</button></td></tr>';
    });
    t.innerHTML = h;
    el('startLv').value = lv0;

    t.querySelectorAll('[data-k]').forEach(function (inp) {
      inp.onchange = function () {
        var i = +inp.dataset.r, k = inp.dataset.k;
        if (k === 'skip') { S.rows[i].skip = Math.max(0, inp.value | 0); }
        else if (k === 'lv') {                            // 等级:改此行,后续行顺延 +1(转职等级重置时只改一行)
          var v0 = Math.max(1, inp.value | 0);
          for (var y = i; y < S.rows.length; y++) S.rows[y].lv = v0 + (y - i);
          syncPredRows();
        }
        else {                                            // 职业/坐骑/好感:向后传播(好感存数字,否则回显比较失效)
          var v = (k === 'bond') ? +inp.value : inp.value;
          for (var x = i; x < S.rows.length; x++) S.rows[x][k] = v;
        }
        save(); renderPlan(); renderCharSelectors(); renderChar(); refreshPredictions();
      };
    });
    t.querySelectorAll('[data-obrow]').forEach(function (b) {
      b.onclick = function () {
        var r = S.rows[+b.dataset.obrow];
        r.obs = r.obs ? null : [0, 0, 0, 0, 0, 0, 0, 0, 0];   // 开=全0,点击格子变1
        save(); renderPlan();
      };
    });
    t.querySelectorAll('.obBtn').forEach(function (b) {
      function setVal(v) {
        var r = S.rows[+b.dataset.r];
        r.obs[+b.dataset.j] = v;
        b.textContent = v;
        b.className = 'obBtn' + (v === 1 ? ' on1' : v >= 2 ? ' on2' : '');
        save(); refreshPredictions();
      }
      b.onclick = function (ev) {                           // 左键 0↔1;Shift+左键=2
        var cur = S.rows[+b.dataset.r].obs[+b.dataset.j] | 0;
        setVal(ev.shiftKey ? (cur === 2 ? 0 : 2) : (cur === 1 ? 0 : 1));
      };
      b.oncontextmenu = function (ev) {                     // 右键 0↔2
        ev.preventDefault();
        var cur = S.rows[+b.dataset.r].obs[+b.dataset.j] | 0;
        setVal(cur === 2 ? 0 : 2);
      };
    });
    t.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        S.rows.splice(+b.dataset.del, 1);
        if (!S.rows.length) S.rows = [newRow()];        // 至少留一行
        syncPredRows(); save(); renderCharSelectors(); renderChar(); renderPlan();
      };
    });
    refreshPredictions();
  }
  el('addRows').onclick = function () {
    var last = S.rows[S.rows.length - 1] || newRow();
    var lv = last.lv | 0;
    for (var i = 0, n = Math.max(1, el('addN').value | 0); i < n; i++)
      S.rows.push({ skip: 0, cls: last.cls, mount: last.mount, bond: last.bond, lv: ++lv, obs: [0, 0, 0, 0, 0, 0, 0, 0, 0] });   // 等级接续末行
    syncPredRows(); save(); renderPlan();
  };
  el('clearObs').onclick = function () {                // 删掉所有观测行(未观测的保留)
    S.rows = S.rows.filter(function (r) { return !r.obs; });
    if (!S.rows.length) S.rows = [newRow()];            // 删空则至少留一行
    syncPredRows(); save(); renderCharSelectors(); renderChar(); renderPlan();
  };
  el('startLv').onchange = function () {                // 起始等级:全表按顺序重排(会覆盖单行改的等级)
    S.startLv = Math.max(1, el('startLv').value | 0);
    S.rows.forEach(function (r, i) { r.lv = S.startLv + i; });
    syncPredRows(); save(); renderPlan();
  };

  // ---------- 组装扫描输入(资格由 worker 按 cur 现算,这里只给合成参数) ----------
  function buildInputs() {
    return S.rows.map(function (r) {
      return { g9: rowGrowth(r), gc: rowGc(r), cap9: rowCaps(r), skip: r.skip | 0 };
    });
  }
  function observedList() {
    return S.rows.map(function (r) {
      if (!r.obs) return null;                              // 未观测行
      return r.obs.map(function (v) { return v == null ? 0 : v; });   // 兼容旧存档的空槽
    });
  }

  // ---------- 扫描(多线程三层:http(s) 直连 Worker / file:// Blob Worker / 主线程分片) ----------
  var workers = [], scanning = false, mainChunkTimer = null;
  function makeWorker() {
    try { return new Worker('worker.js'); }               // ① http(s):任何浏览器/手机
    catch (e) {
      if (window.__WORKER_SRC)                            // ② file:// 直开(桌面/安卓 Chrome 等 origin:null)
        return new Worker(URL.createObjectURL(new Blob([window.__WORKER_SRC], { type: 'text/javascript' })));
      throw e;                                            // ③ 交给外层回退主线程
    }
  }
  function setProgress(done, total, extra) {
    el('progressBox').style.display = total ? 'block' : 'none';
    el('progFill').style.width = (100 * done / total).toFixed(1) + '%';
    el('progText').textContent = extra + ' ' + (100 * done / total).toFixed(1) + '%(候选 ' + doneMatches + ')';
  }
  var doneMatches = 0, overflowed = false;
  function finishScan(all, truncated, earlyStop) {
    scanning = false;
    el('cancelBtn').style.display = 'none'; el('scanBtn').disabled = false;
    el('progressBox').style.display = 'none';
    S.candidates = all;
    var w = el('warnBox');
    if (truncated || overflowed) {
      w.style.display = 'block';
      w.textContent = '⚠ 候选超过上限 20 万,结果不完整 —— 请补录更多观测再过滤(通常 3-4 级观测即可收窄到千级)。';
    } else if (earlyStop) {
      w.style.display = 'block';
      w.textContent = '观测 ≥5 条,命中 1 个候选即停(未扫完全域);如需复核可点"用当前观测在候选内收窄"。';
    } else w.style.display = 'none';
    renderCandidates();
  }
  el('scanBtn').onclick = function () {
    if (scanning) return;
    var obs = observedList(), nObs = obs.filter(Boolean).length;
    if (!nObs) return alert('请先在计划表填至少一行观测(哪几项加了点)');
    if (nObs === 1) {
      var w = el('warnBox'); w.style.display = 'block';
      w.textContent = '⚠ 仅 1 级观测:预期候选可达数百万,扫描耗时且大概率溢出。建议录 2-3 级连续观测。';
    }
    var levels = buildInputs();
    var RANGE = el('full32').checked ? 0xFFFFFFFF : 0x7FFFFFFF;
    scanning = true; doneMatches = 0; overflowed = false;
    el('scanBtn').disabled = true; el('cancelBtn').style.display = 'inline-block';
    var msg = { cmd: 'scan', levels: levels, observed: obs, cur0: ZERO9.slice(), cap: 200000,
      stopOnFirst: nObs >= 5,                            // 观测 ≥5:命中 1 个候选即停(用户规则)
      wasm: ENGINE_WASM ? ENGINE_WASM.slice(0) : null }; // 已导入通用引擎则走 WASM
    var all = [], truncated = false, nw = 0;
    try {
      var NW = Math.min(navigator.hardwareConcurrency || 4, 8), per = Math.floor(RANGE / NW);
      for (var i = 0; i < NW; i++) {
        var wk = makeWorker();
        workers.push(wk);
        wk.onmessage = (function (wk, i2) { return function (e) {
          if (!scanning) return;                         // 早停/取消后到达的迟到消息
          var m = e.data;
          if (m.type === 'progress') { wk._done = m.done; wk._m = m.matches; aggregate(); }
          else if (m.type === 'overflow') { overflowed = true; }
          else if (m.type === 'done') {
            wk._done = m.done; wk._m = m.matches;
            if (m.truncated) truncated = true;
            var arr = m.seeds || [];                     // Uint32Array 视图(长度=命中数)
            for (var q = 0; q < arr.length; q++) all.push(arr[q]);   // 逐个 push,勿用 apply(大数组炸栈)
            wk.terminate(); nw--;
            if (msg.stopOnFirst && m.matches >= 1) {     // 首中即停:杀掉其余线程直接出结果
              workers.forEach(function (w2) { w2.terminate(); });
              finishScan(all, truncated, true);
            } else if (nw === 0) finishScan(all, truncated);
          }
        }; })(wk, i);
        // Worker 崩溃兜底:按已报进度结算并结束,绝不能让扫描永久卡住
        wk.onerror = wk.onmessageerror = (function (wk, i2) { return function (e) {
          if (!scanning || wk._fin) return;
          wk._fin = true;
          wk.terminate(); nw--;
          var w = el('warnBox'); w.style.display = 'block';
          w.textContent = '⚠ 线程 ' + (i2 + 1) + ' 中途崩溃(' + ((e && e.message) || 'worker error') +
            '),其未扫完的区间未覆盖;建议直接重扫。';
          if (nw === 0) finishScan(all, truncated);
        }; })(wk, i);
        wk.postMessage(Object.assign({}, msg, { from: i * per, to: i === NW - 1 ? RANGE : (i + 1) * per - 1 }));
        nw++;
      }
      function aggregate() {
        var d = 0, mm = 0;
        workers.forEach(function (x) { d += x._done || 0; mm += x._m || 0; });
        doneMatches = mm; setProgress(d, RANGE + 1, '扫描中(' + NW + ' 线程 ' + (msg.wasm ? 'WASM 引擎' : 'JS') + '):');
      }
    } catch (err) {                                     // Worker 完全不可用的环境
      workers = [];
      mainChunkScan(msg, RANGE, function (all2, tr2, e2) { finishScan(all2, tr2, e2); });
    }
  };
  function mainChunkScan(msg, RANGE, cb) {               // 主线程回退:50ms 时间片
    var all = [], truncated = false, s = 0, CHUNK = 200000, stopped = false;
    var gains9 = new Int32Array(9), cur = new Int32Array(9);
    mainChunkTimer = function () { stopped = true; };    // 取消:置停(循环自续,必须用标志打断)
    function step() {
      if (stopped) return;
      var tEnd = Date.now() + 50;
      while (s <= RANGE && Date.now() < tEnd) {
        var end = Math.min(s + CHUNK, RANGE + 1);
        for (; s < end; s++) {
          if (M.matchSeed(s, msg.levels, msg.observed, msg.cur0, gains9, cur)) {
            if (all.length < 200000) all.push(s); else { truncated = true; break; }
            if (msg.stopOnFirst && all.length >= 1) { cb(all, truncated, true); return; }   // 观测≥5 首中即停
          }
        }
      }
      doneMatches = all.length; setProgress(s, RANGE + 1, '主线程扫描(无 Worker):');
      if (s > RANGE || truncated) cb(all, truncated);
      else setTimeout(step, 0);
    }
    setTimeout(step, 0);
  }
  el('cancelBtn').onclick = function () {
    workers.forEach(function (w) { w.terminate(); }); workers = [];
    if (mainChunkTimer) mainChunkTimer();               // 调用置停闭包(打断自续循环)
    finishScan(S.candidates || [], false);
  };
  el('refilterBtn').onclick = function () {              // 候选内本地收窄
    if (!S.candidates || !S.candidates.length) return alert('没有候选;先全扫描');
    var levels = buildInputs(), obs = observedList(), cur0 = ZERO9.slice();
    var gains9 = new Int32Array(9), cur = new Int32Array(9);
    S.candidates = S.candidates.filter(function (s) { return M.matchSeed(s, levels, obs, cur0, gains9, cur); });
    renderCandidates();
  };

  // ---------- 候选与预测(预测区覆盖观测段镜像+未来段,种子链整条走预测行) ----------
  function predictChain(seed) {                          // 单种子从观测最低等级一路走到 99 级
    var cur = ZERO9.slice(), out = [];
    S.predRows.forEach(function (r) {
      for (var k = 0; k < (r.skip | 0); k++) seed = C.advanceSeed(seed);
      var res = C.levelup(seed, rowGrowth(r), cur, rowCaps(r), rowGc(r));
      out.push({ seedBefore: seed, gains: res.gains, applied: res.applied, draws: res.draws });
      cur = cur.map(function (v, j) { return v + res.applied[j]; });
      seed = res.nextSeed;
    });
    return out;
  }
  var selectedCand = null;
  function renderCandidates() {
    var cs = S.candidates, sum = el('candSummary'), pickRow = el('candPickRow');
    if (cs === null) { sum.textContent = '未过滤。'; pickRow.style.display = 'none'; refreshPredictions(); return; }
    sum.textContent = '候选种子:' + cs.length + ' 个' + (cs.length ? '(选中后下方预测区显示其预测;再录观测可收窄)' : '(无匹配 —— 检查成长率/观测/gc)');
    if (!cs.length) { pickRow.style.display = 'none'; refreshPredictions(); return; }
    pickRow.style.display = 'flex';
    var sel = el('candPick');
    sel.innerHTML = cs.slice(0, 500).map(function (s) { return '<option value="' + s + '">' + s + ' (0x' + (s >>> 0).toString(16).toUpperCase() + ')</option>'; }).join('');
    selectedCand = cs[0];                                 // 唯一候选默认选中
    refreshPredictions();
  }
  el('candPick').onchange = function () { selectedCand = +el('candPick').value; refreshPredictions(); };

  function consensusNote(cs) {
    if (cs.length <= 1) return cs.length === 1 ? '唯一候选 ✓ 预测确定' : '';
    var top = cs.slice(0, 1000);                        // 预测链到 99 级较长,共识取前 1000 个候选
    var patterns = {};
    top.forEach(function (s) {
      var key = predictChain(s).map(function (r2) { return r2.gains.join(','); }).join(';');
      patterns[key] = (patterns[key] || 0) + 1;
    });
    var keys = Object.keys(patterns);
    if (keys.length === 1) return '前 ' + top.length + ' 候选预测完全一致';
    return '前 ' + top.length + ' 候选有 ' + keys.length + ' 种未来,选中查看个别';
  }

  function currentSeed() {
    if (selectedCand !== null && S.candidates && S.candidates.length) return selectedCand;
    if (el('knownSeed').value.trim()) { var k = parseSeed(el('knownSeed').value); if (k !== null) return k; }
    return null;
  }
  function refreshPredictions() {                        // 渲染独立预测区(观测表不再显示预测/种子)
    var seed = currentSeed(), t = el('predTable'), hint = el('predHint');
    var note = el('consensusNote');
    if (S.candidates && S.candidates.length) note.textContent = consensusNote(S.candidates);
    if (seed === null) {
      t.innerHTML = '';
      hint.style.display = 'inline';
      hint.textContent = '先在上方"种子过滤"选候选(唯一候选自动选中),或用"高级"里已知种子';
      return;
    }
    hint.style.display = 'none';
    if (!S.predRows.length) {                           // 理论不会发生(syncPredRows 保证),防御
      t.innerHTML = '';
      hint.style.display = 'inline';
      hint.textContent = '预测行为空,改动观测行后自动生成';
      return;
    }
    var chain = predictChain(seed), h = '<tr><th>等级</th><th>升级前的转职跳过次数</th><th>升级时职业</th><th>升级时坐骑</th><th>坐骑好感</th><th>预测加点' + HEAD9 + '</th><th>升级所用种子</th></tr>';
    S.predRows.forEach(function (r, i) {                // 所有行可编辑(观测段默认继承观测行,可自由改做推演)
      var o = chain[i];
      var cells = DISP.map(function (e) { var v = o.gains[e]; return '<b' + (v ? '' : ' class="z"') + '>' + v + '</b>'; }).join('');
      h += '<tr>' +
        '<td style="padding:0;font-size:13px;white-space:nowrap;color:var(--dim)"><input class="no" data-r="' + i + '" data-k="lv" type="number" min="1" value="' + (r.lv | 0) + '">级→' + ((r.lv | 0) + 1) + '级</td>' +
        '<td style="padding:0"><input class="no" data-r="' + i + '" data-k="skip" value="' + r.skip + '"></td>' +
        '<td style="padding:0"><select data-r="' + i + '" data-k="cls">' + S.classes.map(function (p) { return '<option value="' + p.id + '"' + (p.id === r.cls ? ' selected' : '') + '>' + p.name + '</option>'; }).join('') + '</select></td>' +
        '<td style="padding:0"><select data-r="' + i + '" data-k="mount"><option value="none"' + (r.mount === 'none' ? ' selected' : '') + '>步行</option>' + S.mounts.map(function (p) { return '<option value="' + p.id + '"' + (p.id === r.mount ? ' selected' : '') + '>' + p.name + '</option>'; }).join('') + '</select></td>' +
        '<td style="padding:0"><select data-r="' + i + '" data-k="bond">' + [1, 2, 3, 4, 5].map(function (b) { return '<option' + (b === (r.bond | 0) ? ' selected' : '') + '>' + b + '</option>'; }).join('') + '</select></td>' +
        '<td><div class="g9">' + cells + '</div></td>' +
        '<td class="u"><span style="font-size:12px">' + o.seedBefore + '</span></td></tr>';
    });
    t.innerHTML = h;
    t.querySelectorAll('[data-k]').forEach(function (inp) {   // 未来段:与观测表同语义,改后向后传播(仅预测区内)
      inp.onchange = function () {
        var i = +inp.dataset.r, k = inp.dataset.k;
        if (k === 'skip') { S.predRows[i].skip = Math.max(0, inp.value | 0); }
        else if (k === 'lv') {
          var v0 = Math.max(1, inp.value | 0);
          for (var y = i; y < S.predRows.length; y++) S.predRows[y].lv = v0 + (y - i);
        }
        else {
          var v = (k === 'bond') ? +inp.value : inp.value;
          for (var x = i; x < S.predRows.length; x++) S.predRows[x][k] = v;
        }
        save(); refreshPredictions();
      };
    });
  }
  el('knownRun').onclick = function () {
    var k = parseSeed(el('knownSeed').value);
    if (k === null) return alert('种子格式:十进制或 0x 十六进制');
    selectedCand = null; refreshPredictions();
  };
  el('gcDefault').onchange = function () { S.gcDefault = el('gcDefault').value | 0; save(); refreshPredictions(); };

  // ---------- 重置:清空本次预测的全部设置/结果,准备下次(仅保留 WASM 引擎,其存独立键) ----------
  el('resetBtn').onclick = function () {
    if (typeof confirm === 'function' && !confirm('重置人物/观测/候选/预测等全部设置?(已启用的引擎保留)')) return;
    S = defaults();
    S.bond5mig = S.predMig = true;                      // 全新状态,无需再迁移
    if (!S.rows.length) S.rows = [newRow()];
    syncPredRows();
    selectedCand = null;
    el('knownSeed').value = '';
    save();
    renderPersons(); initPerson();                      // 人物回第一个并载入
    renderCharSelectors(); renderChar(); renderPlan(); renderCandidates();
  };

  // ---------- 高级:通用高速引擎(.wasm 文件;所有平台/浏览器一致,含手机/iPhone)----------
  var ENGINE_KEY = 'few_wasm_engine', ENGINE_WASM = null;   // ArrayBuffer 或 null
  function b64decode(s) {                                // 手写 base64,跨环境(含 file:// 与受限环境)
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', m = {}, i;
    for (i = 0; i < 64; i++) m[A.charAt(i)] = i;
    var c = s.replace(/[^A-Za-z0-9+/]/g, ''), bytes = [];
    for (i = 0; i < c.length; i += 4) {
      var a = m[c.charAt(i)] || 0, b = m[c.charAt(i + 1)] || 0, d = m[c.charAt(i + 2)] || 0, e = m[c.charAt(i + 3)] || 0;
      bytes.push((a << 2) | (b >> 4));
      if (i + 2 < c.length) bytes.push(((b & 15) << 4) | (d >> 2));
      if (i + 3 < c.length) bytes.push(((d & 3) << 6) | e);
    }
    return new Uint8Array(bytes).buffer;
  }
  function b64encode(buf) {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i += 3)
      s += A.charAt(b[i] >> 2) + A.charAt(((b[i] & 3) << 4) | ((b[i + 1] || 0) >> 4)) +
        A.charAt((((b[i + 1] || 0) & 15) << 2) | ((b[i + 2] || 0) >> 6)) +
        (i + 2 < b.length ? A.charAt((b[i + 2] || 0) & 63) : '=');
    return s;
  }
  (function () {                                         // 启动即恢复已导入的引擎(长期记忆)
    try { var e64 = localStorage.getItem(ENGINE_KEY); if (e64) ENGINE_WASM = b64decode(e64); } catch (e) { }
  })();
  function refreshEngineUI() {
    el('engineStat').textContent = ENGINE_WASM ? '已启用(扫描自动走 WASM 高速引擎)' : '未启用(浏览器 JS 计算)';
    el('engineOff').style.display = ENGINE_WASM ? 'inline-block' : 'none';
  }
  el('engineBtn').onclick = function () { el('engineFile').click(); };
  el('engineFile').onchange = function (f) {             // 文件管理器选 few_engine.wasm → 校验魔数 → 入库
    var file = f.target.files[0]; if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      var b = new Uint8Array(rd.result);
      if (!(b[0] === 0 && b[1] === 97 && b[2] === 115 && b[3] === 109)) return alert('不是 .wasm 引擎文件');
      ENGINE_WASM = b.buffer;
      try { localStorage.setItem(ENGINE_KEY, b64encode(b.buffer)); } catch (e) { }   // 存不下则仅本次会话有效
      refreshEngineUI();
    };
    rd.readAsArrayBuffer(file);
  };
  el('engineOff').onclick = function () {
    ENGINE_WASM = null;
    try { localStorage.removeItem(ENGINE_KEY); } catch (e) { }
    refreshEngineUI();
  };

  el('predExport').onclick = function () {               // 预测表导出(JSON:计划+当时整表记录,gains 为显示序)
    var seed = currentSeed();
    var chain = seed !== null ? predictChain(seed) : null;
    var person = preset(S.persons, S.personId);
    var data = {
      app: 'few_sim_pred', v: 1, exportedAt: new Date().toISOString(),
      person: person ? { id: person.id, name: person.name } : null,
      seedUsed: seed, startLv: S.startLv,
      predRows: S.predRows.map(function (r) {
        return { lv: r.lv | 0, skip: r.skip | 0, cls: r.cls, mount: r.mount, bond: r.bond | 0 };
      }),
      table: chain ? chain.map(function (o, i) {
        return { lv: S.predRows[i].lv | 0, seed: o.seedBefore, gains: DISP.map(function (e) { return o.gains[e]; }) };
      }) : []
    };
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'few_pred_' + (person ? person.name : 'plan') + '.json'; a.click();
  };
  el('predImport').onclick = function () { el('predFile').click(); };
  el('predFile').onchange = function (f) {
    var file = f.target.files[0]; if (!file) return;
    var rd = new FileReader();
    rd.onload = function () {
      try {
        var d = JSON.parse(rd.result);
        if (d.app !== 'few_sim_pred') return alert('不是本页导出的预测表 JSON');
        if (d.seedUsed != null) { el('knownSeed').value = String(d.seedUsed); selectedCand = null; }
        if (d.startLv > 0) S.startLv = d.startLv | 0;
        if (d.person && preset(S.persons, d.person.id)) {
          S.personId = d.person.id;
          renderPersons(); el('personSel').value = S.personId; applyPerson();
        }
        if (Array.isArray(d.predRows) && d.predRows.length) {
          S.predRows = d.predRows.map(function (r) {
            return { lv: r.lv | 0, skip: r.skip | 0, cls: r.cls, mount: r.mount, bond: r.bond | 0 };
          });
        }
        save(); renderPlan(); renderCandidates();
      } catch (e) { alert('JSON 解析失败'); }
    };
    rd.readAsText(file);
  };

  // ---------- 启动 ----------
  function initPerson() {          // 进页面即载入人物(修复:原先要切换一次人物才加载)
    if (!S.persons || !S.persons.length) return;         // 无预设,手填
    var pid = (S.personId && preset(S.persons, S.personId)) ? S.personId : '';
    if (!pid && hadSave) {                               // 旧存档没有 personId:按人物成长率指纹找回
      var hit = S.persons.filter(function (p) { return p.growths && p.growths.join() === S.personal.join(); });
      pid = hit.length ? hit[0].id : '';
    }
    if (!pid) pid = S.persons[0].id;
    el('personSel').value = pid;
    S.personId = pid;
    // 存档恢复时表内已是该人物最新数据(含未"存入人物"的当前值/修正),不重新覆盖;仅全新/对不上时载入
    if (!hadSave || S.personal.join() !== preset(S.persons, pid).growths.join()) applyPerson();
    save();
  }
  function runBadge() {
    var r = window.FESelftest.run(C), b = el('badge');
    if (r.pass === r.total) { b.textContent = '自检 ' + r.pass + '/' + r.total + ' ✓'; b.className = 'ok'; return true; }
    b.textContent = '自检失败 ✗'; b.className = 'bad';
    ['scanBtn', 'refilterBtn', 'knownRun'].forEach(function (id) { el(id).disabled = true; });
    return false;
  }
  if (runBadge()) {
    refreshEngineUI();
    renderPersons(); initPerson();
    renderCharSelectors(); renderChar(); renderPlan(); renderCandidates();
  }
})();
