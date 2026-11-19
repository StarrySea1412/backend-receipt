'use strict';
const demos = {
  listener: {init:()=>({up:false}), start:'$ ss -lntp\n:8000 未监听', step(s,a){
    if(a==='listen'){if(s.up)return '$ 启动\n:8000 已由原服务监听';s.up=true;return '$ 启动\nLISTEN 127.0.0.1:8000';}
    if(a==='probe')return s.up?'$ curl /healthz\nHTTP 200 OK\n{"status":"ok"}':'$ curl /healthz\n连接被拒绝 · 无监听者';
    if(a==='occupy')return s.up?'第二次绑定失败：端口已被占用\n原进程仍在监听':'请先启动原服务，再尝试占用同一端口';
    s.up=false;return '$ 退出服务\n:8000 已无监听者';}},
  receipt:{init:()=>({stored:false}),start:'幂等键 k-001 · 任务数 0',step(s,a){
    if(a==='lost'){s.stored=true;return 'DB COMMIT → job-001\n客户端：超时，没有收到回执\n任务数 1';}
    if(a==='retry'){const existing=s.stored;s.stored=true;return `${existing?'复用已存在任务':'首次持久化任务'}\n202 Accepted · job-001\n任务数 1`;}
    if(a==='conflict')return s.stored?'409 Conflict · 同键的请求内容不同\n任务数 1':'先提交原请求，再测试同键换内容';
    return s.stored?'GET /jobs/job-001 → 200 · queued\n任务数 1':'GET /jobs/job-001 → 404\n任务数 0';}},
  transaction:{init:()=>({}),start:'选择一个并发实验（独立运行）',step(s,a){
    if(a==='plain')return 'A: SELECT → 0 行\nB: SELECT → 0 行\nA、B 都 INSERT 成功 → 2 行';
    if(a==='unique')return '20 次 INSERT · 唯一键相同\n1 次创建 · 19 次冲突不插入\n最终 1 行';
    return '连接 A：BEGIN → FOR UPDATE，持锁\n连接 B：FOR UPDATE SKIP LOCKED → 0 行\n连接 A：COMMIT → 释放锁';}},
  worker:{init:()=>({owner:0,expired:false,done:false}),start:'job-001 · queued · 代次 0',step(s,a){
    if(a==='claim'){if(s.owner!==0)return '不能再领取：任务已离开 queued';s.owner=1;return 'A 领取 · running · 代次 1 · 到期 10s';}
    if(a==='expire'){if(s.owner!==1||s.done)return '没有可推进的 A 租约';s.expired=true;return '模拟时钟 10s · A 租约到期，可接管';}
    if(a==='takeover'){if(s.owner!==1||!s.expired)return '接管拒绝 · A 尚未到期或已经接管';s.owner=2;return 'B 接管 · running · 代次 2';}
    if(a==='late'){if(!s.owner)return 'A 没有领取记录';if(s.owner===2)return 'A 迟到：代次 1 ≠ 2 · 写入 0 行';if(s.expired)return 'A 已到期 · 写入 0 行';return '先快进到期并接管，再观察旧 A 的迟到写入';}
    if(s.owner!==2||s.done)return '没有 B 可提交的活跃任务 · 写入 0 行';s.done=true;return 'B：代次 2 匹配 · 写入 1 行\njob-001 · succeeded';}}
};
for(const node of document.querySelectorAll('[data-demo]')){const d=demos[node.dataset.demo];const out=node.querySelector('[data-output]');let state=d.init();out.textContent=d.start;node.addEventListener('click',e=>{const b=e.target.closest('button[data-act]');if(!b||!node.contains(b))return;const act=b.dataset.act;if(act==='reset'){state=d.init();out.textContent=d.start;}else out.textContent=d.step(state,act);});}
