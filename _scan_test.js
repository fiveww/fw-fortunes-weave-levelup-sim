// 端到端扫描测试:argv[2]=URL,验证多线程 Worker 生效并量吞吐
var http = require('http');
var URL = process.argv[2];
function getJson(path){return new Promise(function(res,rej){http.get({host:'127.0.0.1',port:9223,path:path},function(r){var d='';r.on('data',function(c){d+=c;});r.on('end',function(){res(JSON.parse(d));});}).on('error',rej);});}
(async function(){
  var page=(await getJson('/json')).filter(function(t){return t.type==='page';})[0];
  var ws=new WebSocket(page.webSocketDebuggerUrl),id=0,pending={};
  function send(m,p){return new Promise(function(res){var i=++id;pending[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});}
  function ev(expr){return send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:expr});}
  ws.onmessage=function(e){var m=JSON.parse(e.data);if(m.id&&pending[m.id]){pending[m.id](m.result);delete pending[m.id];}}
  await new Promise(function(r){ws.onopen=r;});
  await send('Page.enable');
  await send('Page.navigate',{url:URL});
  await new Promise(function(r){setTimeout(r,1800);});
  await ev("localStorage.clear();location.reload()");
  await new Promise(function(r){setTimeout(r,1800);});
  console.log('URL:', URL);
  console.log('__WORKER_SRC len:', (await ev("typeof __WORKER_SRC==='string'?__WORKER_SRC.length:'MISSING'")).result.value);
  console.log('直连 Worker:', (await ev("(function(){try{var w=new Worker('worker.js');w.terminate();return 'OK'}catch(e){return 'FAIL:'+e.message.slice(0,40)}})()")).result.value);
  await ev("document.getElementById('scanBtn').click()");
  var samples=[];
  for(var i=0;i<3;i++){
    await new Promise(function(r){setTimeout(r,5000);});
    var t=(await ev("document.getElementById('progText').textContent")).result.value;
    samples.push(t.replace(/\s+/g,' ').trim());
  }
  samples.forEach(function(s,i){console.log('t+'+(2+i*2)+'s:',s);});
  // 吞吐估算:取两次采样的百分比差
  var pct=function(s){var m=s.match(/([\d.]+)%/);return m?+m[1]:0;};
  var dpct=pct(samples[2])-pct(samples[0]), dt=10;
  console.log('吞吐≈', (dpct/100*2147483648/dt/1e6).toFixed(1), '百万种子/秒(区间', URL.startsWith('file')?'file://':'http', ')');
  await ev("document.getElementById('cancelBtn').click()");
  ws.close();process.exit(0);
})().catch(function(e){console.error('ERR',e.message);process.exit(1);});
