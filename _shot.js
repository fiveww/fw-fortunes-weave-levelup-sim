/* _shot.js — CDP 截图+布局测量:headless Chrome 渲染 index.html
 * 注入已知种子+预测行,量观测/预测两表名条对齐,再截全页 */
'use strict';
var http = require('http'), fs = require('fs');
var URL = 'file:///C:/Users/nmiot/prng_work/web_sim/index.html';
var OUT = __dirname + '/_shot.png';

function getJson(path) {
  return new Promise(function (res, rej) {
    http.get({ host: '127.0.0.1', port: 9225, path: path }, function (r) {
      var d = ''; r.on('data', function (c) { d += c; }); r.on('end', function () { res(JSON.parse(d)); });
    }).on('error', rej);
  });
}
(async function () {
  var page = (await getJson('/json')).filter(function (t) { return t.type === 'page'; })[0];
  if (!page) throw new Error('no page target');
  var ws = new WebSocket(page.webSocketDebuggerUrl);
  var id = 0; var pending = {};
  function send(method, params) {
    return new Promise(function (res) {
      var i = ++id; pending[i] = res;
      ws.send(JSON.stringify({ id: i, method: method, params: params || {} }));
    });
  }
  ws.onmessage = function (ev) {
    var m = JSON.parse(ev.data);
    if (m.id && pending[m.id]) { pending[m.id](m.result); delete pending[m.id]; }
  };
  await new Promise(function (res) { ws.onopen = res; });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 950, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  await new Promise(function (r) { setTimeout(r, 2000); });
  await send('Runtime.evaluate', { expression:
    "document.getElementById('addN').value='2';document.getElementById('addRows').click();" +
    "document.getElementById('knownSeed').value='123456789';document.getElementById('knownRun').click();" +
    "" });
  await send('Runtime.evaluate', { awaitPromise: true, expression: "document.fonts.ready.then(function(){return 1})" });   // 等中文字体就绪再量,否则回退字体宽度错位
  await new Promise(function (r) { setTimeout(r, 800); });
  var m = await send('Runtime.evaluate', { returnByValue: true, expression:
    "JSON.stringify((function(){" +
    "function C(el){var r=el.getBoundingClientRect();return Math.round(r.left+r.width/2);}" +
    "var ph=document.querySelectorAll('#plan th');" +
    "var nO=ph[6].querySelectorAll('.g9h span');" +
    "var obs=document.querySelectorAll('#plan tr[data-row=\"0\"] .obBtn');" +
    "var okO=nO.length===9&&obs.length===9&&Array.from(nO).every(function(s,i){return Math.abs(C(s)-C(obs[i]))<4;});" +
    "var th=document.querySelectorAll('#predTable th');" +
    "var nP=th.length>6?th[5].querySelectorAll('.g9h span'):[];" +
    "var pv=document.querySelectorAll('#predTable tr:nth-child(2) .g9 b');" +
    "var rows=document.querySelectorAll('#predTable tr').length-1;" +
    "var okP=nP.length===9&&pv.length===9&&Array.from(nP).every(function(s,i){return Math.abs(C(s)-C(pv[i]))<4;});" +
    "var hs=[];ph.forEach(function(t){hs.push(Math.round(t.getBoundingClientRect().height));});" +
    "return {obsAlign:okO, predAlign:okP, predRows:rows,"+
    " sc:Array.from(nP).map(C), vc:Array.from(pv).map(C), osc:Array.from(nO).map(C), obc:Array.from(obs).map(C)," +
    " predNames:Array.from(nP).map(function(s){return s.textContent;})," +
    " predFirstSeed:(document.querySelector('#predTable .u span')||{textContent:''}).textContent," +
    " thHeights:hs, planW:Math.round(document.getElementById('plan').getBoundingClientRect().width)," +
    " predW:Math.round(document.getElementById('predTable').getBoundingClientRect().width)," +
    " scroll:document.body.scrollWidth};})())" });
  console.log(m.result.value);
  var shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  ws.close(); process.exit(0);
})().catch(function (e) { console.error('ERR', e.message); process.exit(1); });
