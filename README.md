# 服务器收到了吗 · 造物手记 VOL.19

[在线阅读](https://starrysea1412.github.io/backend-receipt/) · 2026-11-20 实验重写版。两次 `POST /jobs` 表面都超时，读者先看到相同的客户端报错，再通过应用日志、数据库、中转日志和同键重试判断发生了什么。

- `verify/http-receipt-lab.py` 用标准库启动仅监听回环地址的 HTTP 应用和实验中转，并通过 `psql` 写临时 PostgreSQL。一次扣住请求不给应用，另一次在应用提交并返回 202 后扣住响应。客户端 `TimeoutError` 是实测捕获的。应用与中转为实验程序捕获的追踪事件，不是生产日志系统输出。
- `verify/http-receipt-result.json` 是两案的实验记录，`lab-data.js` 只把它包装成供页面读取的离线数据。页面互动是同一份记录的视图，不重新模拟另一组状态。
- 实验边界：单租户、合成文档、无外部 worker。旧版的 20 次并发 SQL 实验仍在 `verify/pg-lab.py` 和 `verify/pg-result.txt`；它不是这条 HTTP 链路的容量结果。
- 画境 Image Studio MCP 生成的回执机插画只是篇末配图，不作实验依据。当前插画只是篇末配图，不作实验依据。

## 复跑

请使用监听回环地址、非默认端口下的独立 PostgreSQL 16 实例，新建空白试验库 `backend_receipt_lab` 与限于本机的实验用户 `lab`。不要连接业务库；每次复跑用新库或独立实例。`--psql` 可传客户端绝对路径。

```text
python verify/http-receipt-lab.py --port 55447 --database backend_receipt_lab --output verify/http-receipt-result.json
```

如需用另一轮数据重写页面，`lab-data.js` 应同步包含 `window.receiptLab = <JSON>;`，并核对正文中的编号。安装 Playwright 后运行 `node verify/site.cjs`，或通过 `PLAYWRIGHT_MODULE` 指向已安装的包。`ARTICLE_URL` 非空时用同一套断言核对上线版，不保存截图。
