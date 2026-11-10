/**
 * dsh-ssh browser bundle, in the DSH client module format:
 * `window.__ModuleLoader__.load({ id, factory })` with `require("react")`.
 * The kernel adopts `module.exports` (an object with `apply`) as the plugin.
 *
 * Registers the「SSH 主机」settings section: host CRUD + remote bash test,
 * using the authenticated Connection RPC transport in Web and Desktop.
 */

window.__ModuleLoader__.load({
	id: "dsh-ssh",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		const React = react.default ?? react;
		const e = React.createElement;

		const CSS = `
.ssh-section { --ssh-border: var(--dsw-alias-border-l1, #444); --ssh-muted: var(--dsw-alias-label-secondary, #aaa); --ssh-text: var(--dsw-alias-label-primary, #eee); --ssh-surface: var(--dsw-alias-bg-layer-1, #262626); --ssh-input: var(--dsw-alias-bg-layer-2, #202020); width: 100%; max-width: 820px; min-width: 0; color: var(--ssh-text); font-family: inherit; font-size: 13px; line-height: 1.5; display: flex; flex-direction: column; gap: 20px; }
.ssh-section *, .ssh-section *::before, .ssh-section *::after { box-sizing: border-box; }
.ssh-section h2, .ssh-section h3, .ssh-section h4, .ssh-section p { margin: 0; }
.ssh-section h2 { font-size: 20px; line-height: 1.4; font-weight: 650; }
.ssh-section h3 { font-size: 15px; line-height: 1.5; font-weight: 600; }
.ssh-section h4 { font-size: 12px; font-weight: 600; color: var(--ssh-muted); }
.ssh-header, .ssh-between { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.ssh-header p { margin-top: 5px; color: var(--ssh-muted); font-size: 12px; }
.ssh-section .ssh-button, .ssh-section .ssh-tab { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; width: auto; padding: 6px 12px; border: 1px solid var(--ssh-border); border-radius: 7px; background: transparent; color: var(--ssh-text); font: inherit; font-size: 12px; font-weight: 500; line-height: 20px; cursor: pointer; white-space: nowrap; box-shadow: none; }
.ssh-section button:hover:not(:disabled), .ssh-menu summary:hover { background: color-mix(in srgb, var(--ssh-text) 6%, transparent); }
.ssh-section button:disabled { opacity: .4; cursor: default; }
.ssh-section .ssh-primary { background: var(--ssh-text); color: var(--ssh-input); border-color: transparent; }
.ssh-section .ssh-primary:hover:not(:disabled) { background: var(--ssh-text); opacity: .85; }
.ssh-tabs { display: flex; gap: 24px; border-bottom: 1px solid var(--ssh-border); }
.ssh-section .ssh-tabs .ssh-tab { border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: 0 1px 11px; color: var(--ssh-muted); }
.ssh-section .ssh-tabs .is-active { color: var(--ssh-text); border-bottom-color: var(--ssh-text); }
.ssh-panel { border: 1px solid var(--ssh-border); border-radius: 12px; padding: 22px; background: var(--ssh-surface); }
.ssh-editor, .ssh-tool-panel, .ssh-stack { display: flex; flex-direction: column; gap: 18px; }
.ssh-group { display: flex; flex-direction: column; gap: 14px; padding-top: 18px; border-top: 1px solid var(--ssh-border); }
.ssh-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.ssh-connection { grid-template-columns: minmax(0, 1fr) 90px; }
.ssh-field { display: flex; flex-direction: column; gap: 7px; min-width: 0; font-size: 12px; }
.ssh-label { font-size: 12px; font-weight: 500; color: var(--ssh-text); }
.ssh-hint { color: var(--ssh-muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.ssh-section input, .ssh-section select, .ssh-section textarea { appearance: auto; width: 100%; min-width: 0; max-width: none; margin: 0; padding: 8px 10px; border: 1px solid var(--ssh-border); border-radius: 7px; color: var(--ssh-text); background: var(--ssh-input); font: inherit; font-size: 13px; line-height: 20px; box-shadow: none; outline: none; }
.ssh-section input, .ssh-section select { height: 38px; }
.ssh-section input::placeholder { color: var(--ssh-muted); opacity: .55; }
.ssh-section textarea { resize: vertical; min-height: 108px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.ssh-section input:disabled { opacity: .55; }
.ssh-section :is(input, select, textarea, button, summary):focus-visible { outline: 2px solid #7aa2ef; outline-offset: 2px; }
.ssh-advanced { border-top: 1px solid var(--ssh-border); padding-top: 16px; }
.ssh-section summary { cursor: pointer; color: var(--ssh-muted); font-size: 12px; }
.ssh-advanced[open] > summary { margin-bottom: 16px; }
.ssh-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 16px; border-top: 1px solid var(--ssh-border); }
.ssh-empty { padding: 42px 20px; border: 1px dashed var(--ssh-border); border-radius: 12px; text-align: center; }
.ssh-empty-icon { margin-bottom: 12px; font-size: 28px; color: var(--ssh-muted); }
.ssh-empty p { margin-top: 6px; font-size: 12px; color: var(--ssh-muted); }
.ssh-host-list { display: flex; flex-direction: column; gap: 10px; }
.ssh-host { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px; border: 1px solid var(--ssh-border); border-radius: 10px; background: var(--ssh-surface); }
.ssh-host-info { min-width: 0; overflow-wrap: anywhere; }
.ssh-host-name { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 5px; }
.ssh-host-name strong { font-size: 14px; font-weight: 600; }
.ssh-badge { padding: 1px 7px; border: 1px solid var(--ssh-border); border-radius: 5px; font-size: 10px; color: var(--ssh-muted); }
.ssh-host code { background: transparent; padding: 0; font-size: 12px; color: var(--ssh-muted); }
.ssh-host-info p { margin-top: 4px; font-size: 11px; }
.ssh-host-actions { display: flex; align-items: center; flex-shrink: 0; gap: 6px; }
.ssh-menu { position: relative; }
.ssh-menu > summary { display: flex; align-items: center; justify-content: center; list-style: none; width: 32px; height: 34px; border-radius: 6px; letter-spacing: 1px; }
.ssh-menu > summary::-webkit-details-marker { display: none; }
.ssh-menu-items { position: absolute; z-index: 2; right: 0; top: 38px; min-width: 110px; padding: 4px; border: 1px solid var(--ssh-border); border-radius: 8px; background: var(--ssh-surface); box-shadow: 0 8px 24px #0003; }
.ssh-menu-items .ssh-button { display: flex; width: 100%; border: 0; justify-content: flex-start; }
.ssh-section .ssh-danger, .ssh-error { color: #e96c6c; }
.ssh-alert { padding: 12px 14px; border: 1px solid #e96c6c50; border-radius: 9px; background: #e96c6c09; }
.ssh-alert strong { font-size: 12px; font-weight: 500; }
.ssh-alert details { margin-top: 6px; }
.ssh-alert .ssh-error { margin-top: 8px; font: 11px/1.6 ui-monospace, monospace; overflow-wrap: anywhere; }
.ssh-segment { display: inline-flex; align-self: flex-start; padding: 3px; gap: 3px; border: 1px solid var(--ssh-border); border-radius: 8px; background: var(--ssh-input); }
.ssh-section .ssh-segment .ssh-tab { border: 0; min-height: 30px; padding: 3px 14px; color: var(--ssh-muted); }
.ssh-section .ssh-segment .is-active { color: var(--ssh-text); background: var(--ssh-surface); box-shadow: 0 1px 3px #0002; }
.ssh-result { display: flex; flex-direction: column; gap: 8px; font-size: 12px; }
.ssh-result pre { margin: 0; padding: 12px; border: 1px solid var(--ssh-border); border-radius: 7px; background: var(--ssh-input); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 240px; overflow: auto; font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; }
.ssh-success { color: #68b995; }
@media (max-width: 560px) { .ssh-header { align-items: flex-start; flex-wrap: wrap; gap: 12px; } .ssh-grid { grid-template-columns: minmax(0, 1fr); } .ssh-connection { grid-template-columns: minmax(0, 1fr) 90px; } .ssh-panel { padding: 16px; } .ssh-host { align-items: flex-start; flex-direction: column; gap: 12px; } .ssh-host-actions { align-self: flex-end; } }
`;

		async function request(connection, method, path, body) {
			const result = await connection.rpc.call('/api', 'dsh-ssh/request', {
				method, path: path.slice('/dsh-ssh/api'.length), ...(body === undefined ? {} : { body }),
			})
			if (!result.ok) throw new Error(result.error.message)
			return result.value
		}
		function button(label, onClick, options = {}) {
			return e('button', { type: 'button', className: 'ssh-button', onClick, ...options }, label)
		}

		function field(label, control, hint) {
			return e('label', { className: 'ssh-field' },
				e('span', { className: 'ssh-label' }, label), control,
				hint && e('span', { className: 'ssh-hint' }, hint))
		}

		function Section({ connection }) {
			const apiGet = (path) => request(connection, 'GET', path)
			const apiSend = (method, path, body) => request(connection, method, path, body)
			const [hosts, setHosts] = React.useState([])
			const [error, setError] = React.useState('')
			const [form, setForm] = React.useState(null)
			const [tab, setTab] = React.useState('hosts')
			const [tool, setTool] = React.useState('command')
			const [loading, setLoading] = React.useState(true)
			const [busy, setBusy] = React.useState('')
			const [runTarget, setRunTarget] = React.useState('')
			const [runCmd, setRunCmd] = React.useState('hostname && uptime')
			const [runOut, setRunOut] = React.useState(null)
			const [txDir, setTxDir] = React.useState('upload')
			const [txLocal, setTxLocal] = React.useState('')
			const [txRemote, setTxRemote] = React.useState('')
			const [txOut, setTxOut] = React.useState(null)

			async function refresh() {
				setLoading(true)
				try {
					const result = await apiGet('/dsh-ssh/api/hosts')
					if (!Array.isArray(result)) throw new Error('主机列表格式不正确')
					setHosts(result); setError('')
				} catch (err) { setError(String(err.message || err)) }
				finally { setLoading(false) }
			}
			React.useEffect(() => { refresh() }, [])

			function openForm(host, mode) {
				setError(''); setTab('hosts')
				setForm(host ? {
					...host, password: '', id: mode === 'copy' ? host.id + '-copy' : host.id,
					name: mode === 'copy' ? (host.name || host.id) + ' 副本' : host.name,
					...(mode === 'copy' ? { _copyOf: host.id } : { _editing: host.id }),
				} : { authType: 'agent', port: 22, user: 'root', shell: 'auto' })
			}

			async function submit(event) {
				event.preventDefault()
				setBusy('save')
				try {
					const payload = {
						id: form.id.trim(), host: form.host.trim(), name: (form.name || '').trim() || form.id.trim(),
						port: Number(form.port), user: (form.user || '').trim() || 'root',
					}
					if (!form._copyOf) {
						Object.assign(payload, { authType: form.authType, shell: form.shell || 'auto', note: form.note || '' })
						if (form.authType === 'key') payload.keyPath = form.keyPath || ''
						if (form.authType === 'password' && form.password) payload.password = form.password
					}
					const path = form._editing ? '/hosts/' + encodeURIComponent(form._editing)
						: form._copyOf ? '/hosts/' + encodeURIComponent(form._copyOf) + '/copy' : '/hosts'
					await apiSend('POST', '/dsh-ssh/api' + path, payload)
					setForm(null); await refresh()
				} catch (err) { setError(String(err.message || err)) }
				finally { setBusy('') }
			}

			async function remove(id) {
				if (!window.confirm('删除主机 ' + id + '？')) return
				setBusy('delete')
				try {
					await apiSend('DELETE', '/dsh-ssh/api/hosts/' + encodeURIComponent(id))
					if (runTarget === id) setRunTarget('')
					await refresh()
				} catch (err) { setError(String(err.message || err)) }
				finally { setBusy('') }
			}

			async function execute(event) {
				event.preventDefault(); setBusy(tool); setError('')
				try {
					if (tool === 'command') {
						setRunOut(null)
						setRunOut(await apiSend('POST', '/dsh-ssh/api/bash', { host: runTarget, command: runCmd, timeoutMs: 60000 }))
					} else {
						setTxOut(null)
						setTxOut(await apiSend('POST', '/dsh-ssh/api/' + txDir, { host: runTarget, localPath: txLocal, remotePath: txRemote }))
					}
				} catch (err) {
					const result = { ok: false, error: String(err.message || err) }
					if (tool === 'command') setRunOut(result)
					else setTxOut(result)
				} finally { setBusy('') }
			}

			const input = (value, onChange, props = {}) => e('input', { value: value ?? '', onChange, ...props, disabled: !!busy || !!props.disabled })
			const select = (value, onChange, options) => e('select', { value, onChange, disabled: !!busy },
				options.map(([id, label]) => e('option', { key: id, value: id }, label)))
			const set = (key) => (event) => setForm({ ...form, [key]: event.target.value })
			const authNames = { agent: 'SSH Agent', key: '私钥', password: '密码' }
			const children = [e('header', { key: 'header', className: 'ssh-header' },
				e('div', null, e('h2', null, 'SSH 主机'), e('p', null, '管理远程连接，供 Agent 执行命令和传输文件。')),
				!form && tab === 'hosts' && button('+ 添加主机', () => openForm(), { className: 'ssh-button ssh-primary', disabled: !!busy })),
				e('nav', { key: 'tabs', className: 'ssh-tabs', 'aria-label': 'SSH 设置' },
					[['hosts', '主机管理'], ['tools', '连接工具']].map(([id, label]) => button(label, () => { setTab(id); setError('') },
						{ key: id, 'aria-current': tab === id ? 'page' : undefined, disabled: !!busy, className: 'ssh-tab' + (tab === id ? ' is-active' : '') }))) ]

			if (error) children.push(e('div', { key: 'error', className: 'ssh-alert', role: 'alert' },
				e('div', { className: 'ssh-between' }, e('strong', null, form ? '未能保存主机' : '暂时无法完成操作'),
					!form && button('重试', refresh, { disabled: loading })),
				/HTTP (404|405)\b/.test(error) && e('p', { className: 'ssh-hint' }, 'SSH 后端可能尚未更新。请完全退出 DeepSeek Harness 后重新打开；仅刷新页面不会重新加载后端。'),
				e('details', null, e('summary', null, '查看错误详情'), e('div', { className: 'ssh-error' }, error))))

			if (tab === 'hosts' && form) {
				const basic = [
					field('显示名称', input(form.name, set('name'), { placeholder: '例如：开发服务器' })),
					field('主机标识 *', input(form.id, set('id'), { required: true, disabled: !!form._editing, placeholder: 'build-server', pattern: '.*\\S.*' }), '供 Agent 引用，创建后不可更改。'),
					field('主机地址 *', input(form.host, set('host'), { required: true, placeholder: '192.168.1.10 或域名' })),
					e('div', { className: 'ssh-grid ssh-connection' },
						field('用户名', input(form.user, set('user'), { placeholder: 'root' })),
						field('端口', input(form.port, set('port'), { type: 'number', min: 1, max: 65535, required: true }))),
				]
				const auth = [field('认证方式', select(form.authType, set('authType'), Object.entries(authNames)))]
				if (form.authType === 'password') auth.push(field(form.hasPassword ? '密码（留空保留原密码）' : '密码',
					input(form.password, set('password'), { type: 'password', autoComplete: 'new-password', required: !form.hasPassword, placeholder: form.hasPassword ? '不修改原密码' : '输入登录密码' }),
					'密码保存在本机配置文件中，建议优先使用私钥。'))
				else if (form.authType === 'key') auth.push(field('私钥文件路径', input(form.keyPath, set('keyPath'), { required: true, placeholder: '~/.ssh/id_ed25519' })))
				else auth.push(e('p', { className: 'ssh-hint' }, '使用本机 SSH Agent 或默认 SSH 配置中的身份进行认证。'))
				children.push(e('form', { key: 'form', className: 'ssh-panel ssh-editor', onSubmit: submit },
					e('div', { className: 'ssh-between' }, e('h3', null, form._editing ? '编辑主机' : form._copyOf ? '复制主机' : '添加主机'),
						button('返回列表', () => setForm(null), { disabled: !!busy })),
					e('section', { className: 'ssh-group' }, e('h4', null, '连接信息'), e('div', { className: 'ssh-grid' }, basic)),
					e('section', { className: 'ssh-group' }, e('h4', null, '身份认证'), form._copyOf
						? e('p', { className: 'ssh-hint' }, '继承源主机的认证信息、远端 Shell 和备注，无需重新输入。') : e('div', { className: 'ssh-stack' }, auth)),
					!form._copyOf && e('details', { className: 'ssh-advanced' }, e('summary', null, '更多选项'),
						e('div', { className: 'ssh-grid' },
							field('远端 Shell', select(form.shell || 'auto', set('shell'), [['auto', '自动检测（推荐）'], ['bash', 'bash'], ['ash', 'ash / BusyBox'], ['sh', 'sh']])),
							field('备注', input(form.note, set('note'), { placeholder: '用途、位置等（可选）' })))),
					e('footer', { className: 'ssh-actions' }, button('取消', () => setForm(null), { disabled: !!busy }),
						button(busy === 'save' ? '保存中…' : form._editing ? '保存修改' : form._copyOf ? '复制主机' : '添加主机', undefined,
							{ type: 'submit', className: 'ssh-button ssh-primary', disabled: !!busy || !form.id?.trim() || !form.host?.trim() }))))
			} else if (tab === 'hosts') {
				children.push(e('div', { key: 'count', className: 'ssh-between ssh-list-heading' },
					e('span', { className: 'ssh-hint' }, loading ? '正在读取主机…' : error && !hosts.length ? '主机列表暂不可用' : '已配置 ' + hosts.length + ' 台主机'),
					button('刷新', refresh, { disabled: loading || !!busy })))
				if (!hosts.length && !loading && !error) children.push(e('div', { key: 'empty', className: 'ssh-empty' },
					e('div', { className: 'ssh-empty-icon', 'aria-hidden': true }, '⌘'), e('h3', null, '添加你的第一台主机'),
					e('p', null, '暂无主机，点击「添加主机」创建。')))
				children.push(e('div', { key: 'hosts', className: 'ssh-host-list' }, hosts.map((host) => e('article', { key: host.id, className: 'ssh-host' },
					e('div', { className: 'ssh-host-info' }, e('div', { className: 'ssh-host-name' }, e('strong', null, host.name || host.id),
						e('span', { className: 'ssh-badge' }, authNames[host.authType] || host.authType)),
						e('code', null, host.user + '@' + host.host + ':' + host.port),
						e('p', { className: 'ssh-hint' }, host.id + (host.note ? ' · ' + host.note : ''))),
					e('div', { className: 'ssh-host-actions' },
						button('连接工具', () => { setRunTarget(host.id); setTab('tools'); setRunOut(null); setTxOut(null) }),
						button('编辑', () => openForm(host, 'edit'), { disabled: !!busy }),
						e('details', { className: 'ssh-menu' }, e('summary', { 'aria-label': '更多操作：' + host.id }, '•••'),
							e('div', { className: 'ssh-menu-items' }, button('复制', () => openForm(host, 'copy'), { disabled: !!busy }),
								button('删除', () => remove(host.id), { disabled: !!busy, className: 'ssh-button ssh-danger' }))))))))
			} else {
				const result = tool === 'command' ? runOut : txOut
				const failed = result && (result.error || result.ok === false)
				const output = result && (result.error || (tool === 'command'
					? '退出码：' + result.exitCode + (result.timedOut ? '（超时）' : result.aborted ? '（已取消）' : '') + '\n' + (result.stdout || '') + (result.stderr ? '\n' + result.stderr : '')
					: result.ok ? '传输完成 · ' + (result.bytes ?? '?') + ' 字节\n' + (txDir === 'upload' ? result.remotePath : result.localPath) : result.stderr || '传输失败'))
				children.push(e('form', { key: 'tools', className: 'ssh-panel ssh-tool-panel', onSubmit: execute },
					e('div', null, e('h3', null, '连接工具'), e('p', { className: 'ssh-hint' }, '选择已保存的主机，测试连接或传输文件。')),
					field('目标主机', select(runTarget, (event) => { setRunTarget(event.target.value); setRunOut(null); setTxOut(null) },
						[['', '选择主机…'], ...hosts.map((host) => [host.id, (host.name || host.id) + ' · ' + host.host])])),
					!hosts.length && e('p', { className: 'ssh-hint' }, '请先在「主机管理」中添加主机。'),
					e('div', { className: 'ssh-segment', 'aria-label': '工具类型' }, [['command', '执行命令'], ['transfer', '传输文件']].map(([id, label]) => button(label, () => setTool(id),
						{ key: id, disabled: !!busy, 'aria-pressed': tool === id, className: 'ssh-tab' + (tool === id ? ' is-active' : '') }))),
					tool === 'command' ? field('远程命令', e('textarea', { value: runCmd, onChange: (event) => setRunCmd(event.target.value), rows: 4, required: true, disabled: !!busy, spellCheck: false }), '通过所选主机的远端 Shell 执行。')
						: e('div', { className: 'ssh-stack' }, field('传输方向', select(txDir, (event) => { setTxDir(event.target.value); setTxOut(null) }, [['upload', '上传 · 本机 → 远端'], ['download', '下载 · 远端 → 本机']])),
							field('本地路径', input(txLocal, (event) => setTxLocal(event.target.value), { required: true, placeholder: txDir === 'upload' ? '/path/to/local/file' : '~/Downloads/' })),
							field('远端路径', input(txRemote, (event) => setTxRemote(event.target.value), { required: true, placeholder: txDir === 'upload' ? '/tmp/file' : '/etc/config.conf' })),
							e('p', { className: 'ssh-hint' }, '填写完整文件路径，单个文件最大 128 MB。')),
					e('div', { className: 'ssh-actions' }, button(busy ? '处理中…' : tool === 'command' ? '运行命令' : txDir === 'upload' ? '上传文件' : '下载文件', undefined,
						{ type: 'submit', className: 'ssh-button ssh-primary', disabled: !!busy || !runTarget || (tool === 'command' ? !runCmd.trim() : !txLocal.trim() || !txRemote.trim()) })),
					result && e('div', { className: 'ssh-result', role: 'status' }, e('strong', { className: failed ? 'ssh-error' : 'ssh-success' }, failed ? '操作失败' : '操作完成'), e('pre', null, output))))
			}
			return e('div', { className: 'ssh-section', 'aria-busy': loading || !!busy }, children)
		}

		function apply(ctx) {
			const slots = ctx.get('slots')
			if (slots === undefined) return
			const style = document.createElement('style')
			style.textContent = CSS
			document.head.appendChild(style)
			ctx.effect(() => () => { style.remove() }, 'dsh-ssh client css')
			slots.inject('settings.section', () => slots.register(
				{ name: 'settings.section', id: 'ssh-hosts', order: 60, label: 'SSH 主机' },
				() => e(Section, { connection: ctx.connection }),
			))
		}

		exports.apply = apply;
		exports.inject = ["slots", "connection"];
		return module.exports;
	}
});
