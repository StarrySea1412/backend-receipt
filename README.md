# 服务器收到了吗 · 造物手记 VOL.19

从一次丢失的 HTTP 回执倒查四个环节：端口监听、任务受理、PostgreSQL 并发写入、worker 接管。和 VOL.18 的来源留痕、K8s 手册的容器发布相邻：先判断是哪一层能为「完成」作证。

- 网站：<https://starrysea1412.github.io/backend-receipt/>
- 四段互动均确定性、可重放；页面是 HTML/CSS/JS，不依赖远程运行库。
- 技术结构图为本篇 SVG，四张章节插画为画境 Image Studio MCP `generate_image`、GPT Image 2.5 Sunburst 生成并转为 WebP；插画不是实测截图。回执机插画裁切成 12 帧，经 MCP `assemble_gif` 合成装饰循环；系统偏好减少动态效果时显示静态图。
- PostgreSQL 16.13 本地临时库实测：20 个并发同键插入只有 1 条新记录；另测持锁跳过和接管后的旧代次写入。原样记录在 `verify/pg-result.txt`。不代表生产吞吐、真实集群验收或外部副作用仅发生一次。

## 复跑

已有 Playwright 时，用 `node verify/site.cjs` 复跑 1440px / 390px 的四段行为断言。也可用 `PLAYWRIGHT_MODULE` 指向已安装的包。用 `ARTICLE_URL` 指向线上版本时，跑同一套断言，不保存截图。

`verify/pg-lab.py` 仅连接本机，需要非默认端口上的空白隔离数据库 `backend_receipt_lab`，不允许使用默认端口。脚本会在该库创建 `jobs` 表；每次使用新的临时数据库，不能用现有业务库。
