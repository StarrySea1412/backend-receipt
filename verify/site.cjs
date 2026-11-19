'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs/promises'), http=require('node:http'), path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.gif':'image/gif'};
(async()=>{
  const server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;const f=path.resolve(root,'.'+(p==='/'?'/index.html':p));if(!f.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',mime[path.extname(f)]||'text/plain');res.end(await fs.readFile(f));}catch{res.writeHead(404);res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser; try {
    browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
    for(const width of [1440,390]) {
      const page=await browser.newPage({viewport:{width,height:900}});const errors=[];page.on('pageerror',err=>errors.push(err.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
      const {port}=server.address();const address=process.env.ARTICLE_URL||`http://127.0.0.1:${port}/`;
      assert.equal((await page.goto(address,{waitUntil:'domcontentloaded'})).status(),200);
      assert.match(await page.title(),/VOL\.19/);assert.equal(await page.locator('.chapter').count(),4); assert.equal(await page.locator('.ask').count(),4);
      const anchors=await page.locator('#contents a').evaluateAll(nodes=>nodes.every(n=>document.querySelector(n.getAttribute('href'))));assert(anchors);
      assert.match(await page.locator('#pg-output').textContent(),/attempts=20 inserted=1 rows=1/);
      assert.match(await page.locator('#pg-output').textContent(),/stale_owner_rows=0 current_owner_rows=1/);
      async function press(i,act,expected){await page.locator(`#d${i} button[data-act="${act}"]`).click();assert.match(await page.locator(`#d${i} [data-output]`).textContent(),expected);}
      await press(1,'probe',/连接被拒绝/);await press(1,'listen',/LISTEN/);await press(1,'occupy',/原进程仍在监听/);await press(1,'probe',/200 OK/);await press(1,'stop',/无监听者/);await press(1,'reset',/未监听/);
      await press(2,'lost',/DB COMMIT[\s\S]*超时[\s\S]*任务数 1/);await press(2,'retry',/复用[\s\S]*202 Accepted · job-001[\s\S]*任务数 1/);await press(2,'conflict',/409 Conflict/);await press(2,'query',/queued/);await press(2,'reset',/任务数 0/);await press(2,'query',/404/);
      await press(3,'plain',/2 行/);await press(3,'unique',/最终 1 行/);await press(3,'skip',/0 行/);await press(3,'reset',/独立运行/);
      await press(4,'takeover',/拒绝/);await press(4,'claim',/代次 1/);await press(4,'takeover',/拒绝/);await press(4,'expire',/到期/);await press(4,'takeover',/代次 2/);await press(4,'late',/写入 0 行/);await press(4,'finish',/succeeded/);await press(4,'finish',/写入 0 行/);await press(4,'reset',/queued/);
      const imageResults=await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(async img=>{img.loading='eager';try{await img.decode();return img.naturalWidth>0;}catch{return false;}}))); assert.deepEqual(imageResults,[true,true,true,true,true]);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
      assert.deepEqual(errors,[]);
      if(!process.env.ARTICLE_URL){const target=path.join(root,'shots');await fs.mkdir(target,{recursive:true});await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.screenshot({path:path.join(target,`hero-${width}.png`)});for (const i of [1,2,3,4]) await page.locator(`#d${i}`).screenshot({path:path.join(target,`interaction-${i}-${width}.png`)});}
      console.log(`${width}px: four simulations, resets, proof text, 5 media assets, chapter links, no overflow or JS errors`); await page.close();
    }
  } finally {if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
