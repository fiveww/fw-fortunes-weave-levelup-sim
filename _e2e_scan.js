var http = require('http');
function getJson(path){return new Promise(function(res,rej){http.get({host:'127.0.0.1',port:9223,path:path},function(r){var d='';r.on('data',function(c){d+=c;});r.on('end',function(){res(JSON.parse(d));});}).on('error',rej);});}
(async function(){
  var page=(await getJson('/json')).filter(function(t){return t.type==='page';})[0];
  var ws=new WebSocket(page.webSocketDebuggerUrl),id=0,pending={};
  function send(m,p){return new Promise(function(res){var i=++id;pending[i]=res;ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});}
  function ev(expr){return send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:expr});}
  ws.onmessage=function(e){var m=JSON.parse(e.data);if(m.id&&pending[m.id]){pending[m.id](m.result);delete pending[m.id];}}
  await new Promise(function(r){ws.onopen=r;});
  await send('Page.enable');
  async function run(url,nrows,label){
    await send('Page.navigate',{url:url}); await new Promise(function(r){setTimeout(r,1500);});
    await ev("localStorage.clear();location.reload()"); await new Promise(function(r){setTimeout(r,1500);});
    // 加 (nrows-1) 行 → 共 nrows 个全0观测;最终成长率全改 0(每个种子都命中)
    await ev("document.getElementById('addN').value='"+(nrows-1)+"';document.getElementById('addRows').click()");
    await ev("document.querySelectorAll('#charTable input[data-f=\"adj\"]').forEach(function(i){i.value=0;i.dispatchEvent(new Event('change'))})");
    var t0=Date.now();
    await ev("document.getElementById('scanBtn').click()");
    // 等扫描结束(scanBtn 重新可用),最多 30s
    var st;
    for(var k=0;k<60;k++){
      await new Promise(function(r){setTimeout(r,500);});
      st=(await ev("(function(){return document.getElementById('scanBtn').disabled})()")).result.value;
      if(st===false) break;
    }
    var r=(await ev("(function(){return JSON.stringify({ms:Date.now()-"+t0+",cand:document.getElementById('candSummary').textContent,"+
      "warn:document.getElementById('warnBox').textContent,progHidden:document.getElementById('progressBox').style.display==='none'})})()")).result.value;
    console.log(label, r, 'finished=', st===false);
  }
  await run('file:///C:/Users/nmiot/prng_work/web_sim/index.html', 1, 'A 1行观测(原卡死路径,全命中全done):');
  await run('file:///C:/Users/nmiot/prng_work/web_sim/index.html', 6, 'B 6行观测(≥5 早停):       ');
  ws.close();process.exit(0);
})().catch(function(e){console.error('ERR',e.message);process.exit(1);});
