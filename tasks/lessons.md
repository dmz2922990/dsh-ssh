# 经验记录

- 2026-11-10：用户同时安装 CLI 与桌面版时，不能把 PATH 中 CLI 的版本当作用户实际运行版本。先确认目标发行形态和版本，优先核对桌面版自带运行时。

- 2026-11-10：安装说明必须验证用户实际执行的顶层 CLI 入口。0.2.2-rc.1 底层 plugin 实现仍残留 desktop 分支，但 bin.js 会先拒绝 desktop profile；桌面版必须通过应用内插件管理器安装、更新和卸载，不能仅根据底层实现推导可用命令。
- 2026-11-10：桌面客户端模块图和 Cordis 路由注册通过，不代表 Electron 实际 carrier 支持自定义 RPC channel；必须验证实际请求路径。设置页面需以真实窗口布局验收，不能仅依靠组件 mock 测试。

- 2026-11-10：已确认 405 的具体原因是自定义 rpc.handle 在真实运行时访问未注入的 webServer，路由注册失败；通过 Connection 的精确 Fetch 路由 /api/dsh-ssh/request 修复，并以真实 HostConnectionService 和浏览器 RPC helper 联调验证。

- 2026-11-10：本地 link 插件前端与后端存在不同热更新机制。已在真实桌面观察到详情 v2.2.0、页面来自新代码；完整退出并启动后详情为 v2.2.1，三台主机正常读取，既有主机不改字段保存成功。验证兼容修复时要检查实际运行版本并亲测读写，不能仅看磁盘 package.json 或新版页面。

- 2026-11-10：通过 Harness shell 运行 SSH 会继承用户的连接复用设置，ControlMaster/ControlPath 可能在执行环境不可写目录创建 Unix socket。插件应统一关闭连接复用，不能通过放宽 ~/.ssh 权限或禁用安全警告解决；用真实 ssh -G 验证覆盖及其他配置保留。
