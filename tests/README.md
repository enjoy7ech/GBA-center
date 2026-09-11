# 存档安全回归

`npm run test:save-safety` 在新建的隔离浏览器上下文和随机 localhost 端口测试，不访问真实游戏网站或浏览器存档。

需要可用的 Playwright 包和 Chromium。可通过 `PLAYWRIGHT_MODULE` 指向已有 Playwright 包目录，通过 `CHROMIUM_EXECUTABLE` 指定 Chrome/Edge 可执行文件；未设置时使用默认模块及 Playwright 浏览器。

测试覆盖：旧版数据库迁移、覆盖/导入/删除前历史、事务失败回滚、历史保留限额、截图失败、当前进度导出、导入后自动保存暂停、读档前恢复点、历史恢复、三槽导入与整批校验、跨标签页锁及释放。核心内存使用合成字节，不依赖特定 ROM。
