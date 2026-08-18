# dsh-ssh

DeepSeek Harness (DSH) 动态 Cordis 插件：**SSH 主机管理 + 远程 Bash 执行**。

## 功能

- 📋 **主机管理（增删改查）** — 持久化到 `~/.dsh/ssh-hosts.json`（重启不丢失）
- 🖥️ **设置页面** — 在 GUI 的 Settings 面板注册「SSH 主机」页面，可视化增删改主机、远程执行测试
- 🔧 **模型工具** — `ssh_host_list` / `ssh_host_add` / `ssh_host_update` / `ssh_host_remove` / `ssh_bash`，当前会话的 agent 可直接调用
- 🔌 **Cordis 服务 `ssh.hosts`** — 进程级服务，其他 agent 的插件可通过 `ctx.get('ssh.hosts')` 复用
- 🔑 **三种认证** — `agent`（默认，BatchMode 免交互）/ `key`（私钥路径）/ `password`（SSH_ASKPASS 机制，无需 sshpass、不申请 pty，可在沙箱内运行）

## 安装（作为 DSH 动态插件）

1. 在 DSH 会话中调用 `cordis_define`：
   - `plugin`: `{"kind":"new","idPrefix":"ssh"}`
   - `code.host`：[`plugin/host.js`](plugin/host.js) 的完整内容（纯 JS 函数体）
   - `code.client`：[`plugin/client.js`](plugin/client.js) 的完整内容
2. `cordis_run` 激活（Client 端需在 UI 上批准一次）
3. 刷新页面，Settings 中出现「SSH 主机」页面

> host.js / client.js 是动态插件的**函数体**（plain JavaScript，无 TS/JSX/import），
> 直接粘贴即可；不要包一层 `function`。

## 远程执行原理

```
ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 [-i key] [-p port] user@host -- bash -s
```

脚本通过 **stdin** 传给远端 `bash -s`，多行脚本、循环、管道均可；密码认证通过
`SSH_ASKPASS` + `SSH_ASKPASS_REQUIRE=force`（辅助脚本 `~/.dsh/.ssh-askpass.sh`，
权限 700，仅回显环境变量中的密码），不依赖 pty，适配受限沙箱环境。

## `ssh.hosts` 服务 API

```js
const ssh = ctx.get('ssh.hosts')
await ssh.list()                       // 所有主机（不含密码明文）
await ssh.get(ref)                     // ref: id | name | user@host | host
await ssh.add({ id, host, port, user, name, note, auth: { type, keyPath, password }, tags })
await ssh.update(id, patch)            // 部分字段更新；auth 留空字段保持原值
await ssh.remove(id)
await ssh.bash(ref, command, timeoutMs) // { ok, exitCode, stdout, stderr, timedOut, ... }
```

## 安全提示

- 密码以**明文**存储于 `~/.dsh/ssh-hosts.json`（与 sshpass 类工具一致），建议优先使用密钥认证
- `ssh.host_list` 等返回值不含密码，只有 `hasPassword` 布尔值
