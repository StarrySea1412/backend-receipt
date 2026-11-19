'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs/promises'), http=require('node:http'), path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.gif':'image/gif'};
(async()=>{
  const server=http.createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;const f=path.resolve(root,'.'+(p==='/'?'/index.html':p));if(!f.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',mime[path.extname(f)]||'text/plain');res.end(await fs.readFile(f));}catch{res.writeHead(404);res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
    const proof=JSON.parse(await fs.readFile(path.join(root,'verify/http-receipt-result.json'),'utf8'));
    const packed=await fs.readFile(path.join(root,'lab-data.js'),'utf8');
    const prefix='window.receiptLab = ';assert(packed.startsWith(prefix)&&packed.trimEnd().endsWith(';'),'lab-data.js wrapper');assert.deepEqual(JSON.parse(packed.slice(prefix.length).trim().replace(/;\s*$/,'')),proof);
    assert.equal(proof.timeoutMs,2000);
    const byId=Object.fromEntries(proof.cases.map(x=>[x.id,x]));
    assert.match(byId.A.client,/TimeoutError/);assert.match(byId.B.client,/TimeoutError/);assert.equal(byId.A.client,byId.B.client);
    assert.equal(byId.A.app.length,0);assert.equal(byId.B.app.length,2);
    assert.equal(byId.A.before.length,0);assert.equal(byId.B.before.length,1);assert.match(byId.A.relay[0],/not forwarded/);assert.match(byId.B.app.join(' '),/COMMIT inserted/);assert.match(byId.B.relay[0],/response withheld/);
    assert.equal(byId.A.retry.rows.length,1);assert.equal(byId.B.retry.rows.length,1);
    assert.equal(byId.A.retry.body.job_id,1);assert.equal(String(byId.B.retry.body.job_id),byId.B.before[0].split(/\s+/)[0]);
    assert.deepEqual(byId.A.conflict.rows,byId.A.retry.rows);assert.deepEqual(byId.B.conflict.rows,byId.B.retry.rows);
    assert.equal(byId.A.newKey.rows.length,2);assert.equal(byId.B.newKey.rows.length,2);
    assert.equal(byId.A.conflict.status,409);assert.equal(byId.B.conflict.status,409);
    for(const width of [1440,390]){
      const page=await browser.newPage({viewport:{width,height:900}});const errors=[],external=[];const trustedOrigin=process.env.ARTICLE_URL?new URL(process.env.ARTICLE_URL).origin:null;
      page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      await page.route('**/*',route=>{const u=new URL(route.request().url());if(['127.0.0.1','localhost'].includes(u.hostname)||u.origin===trustedOrigin)return route.continue();external.push(u.origin);return route.abort();});
      const {port}=server.address();const address=process.env.ARTICLE_URL||`http://127.0.0.1:${port}/`;
      assert.equal((await page.goto(address,{waitUntil:'networkidle'})).status(),200);
      assert.match(await page.title(),/VOL\.19/);assert.equal(await page.locator('article.prose section').count(),3);
      assert.match(await page.locator('#initial-output').textContent(),/TimeoutError/);
      const imgs=page.locator('img');assert.equal(await imgs.count(),1);
      const media=await imgs.evaluateAll(xs=>Promise.all(xs.map(async im=>{im.loading='eager';try{await im.decode();return im.naturalWidth>0}catch{return false}})));assert.deepEqual(media,[true]);
      const evidence=page.locator('#evidence');
      await page.getByRole('button',{name:'查应用追踪'}).click();assert.match(await evidence.textContent(),/没有该请求入口事件/);
      await page.getByRole('button',{name:'查数据库'}).click();assert.match(await evidence.textContent(),/\(0 行\)/);
      await page.getByRole('button',{name:'查中转追踪'}).click();assert.match(await evidence.textContent(),/not forwarded/);
      await page.locator('[data-action=retry]').click();assert.match(await evidence.textContent(),/202[\s\S]*job_id[\s\S]*1/);
      await page.locator('[data-action=conflict]').click();assert.match(await evidence.textContent(),/409[\s\S]*different payload/);
      await page.locator('[data-action=newKey]').click();assert.match(await evidence.textContent(),/job_id  idempotency_key[\s\S]*\(2 行\)/);
      await page.locator('#reset').click();assert.match(await evidence.textContent(),/等待取证/);
      await page.locator('[data-case=B]').click();assert.match(await page.locator('#initial-output').textContent(),/TimeoutError/);
      await page.locator('[data-action=app]').click();assert.match(await evidence.textContent(),/COMMIT inserted job_id=4/);
      await page.locator('[data-action=rows]').click();assert.match(await evidence.textContent(),/4  lab-b-01[\s\S]*\(1 行\)/);
      await page.locator('[data-action=relay]').click();assert.match(await evidence.textContent(),/HTTP 202; response withheld/);
      await page.locator('[data-action=retry]').click();assert.match(await evidence.textContent(),/reuse job_id=4[\s\S]*job_id[\s\S]*4/);
      await page.locator('[data-action=conflict]').click();assert.match(await evidence.textContent(),/409/);
      await page.locator('[data-action=newKey]').click();assert.match(await evidence.textContent(),/job_id  idempotency_key[\s\S]*\(2 行\)/);
      await page.locator('[data-case=A]').click();assert.match(await page.locator('#evidence').textContent(),/等待取证/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
      if(!process.env.ARTICLE_URL){const out=path.join(root,'shots');await fs.mkdir(out,{recursive:true});await page.screenshot({path:path.join(out,`hero-${width}.png`),fullPage:true});await page.locator('#lab').screenshot({path:path.join(out,`lab-${width}.png`)});}
      console.log(`${width}px: A/B same timeout, logs + DB distinguish, retries/409/new key, local assets, no overflow/errors/external requests`);await page.close();
    }
  }finally{if(browser)await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
