/**
 * dsh-ssh browser bundle, in the DSH client module format:
 * `window.__ModuleLoader__.load({ id, factory })` with `require("react")`.
 * The kernel adopts `module.exports` (an object with `apply`) as the plugin.
 *
 * Registers the「SSH 主机」settings section: host CRUD + remote bash test,
 * talking to the host half's JSON API under /dsh-ssh/api/*.
 */

window.__ModuleLoader__.load({
	id: "dsh-ssh",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let ui = require("@deepseek-ai/dsh-client-ui-primitives");
		const React = react.default ?? react;
		const Button = (ui.default ?? ui).Button || ui.Button;
		const Input = (ui.default ?? ui).Input || ui.Input;
		const e = React.createElement;

		const CSS = `
.ssh-section { display: flex; flex-direction: column; gap: 14px; }
.ssh-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.ssh-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; background: var(--dsw-alias-bg-layer-1); }
.ssh-card-head { display: flex; align-items: baseline; gap: 8px; justify-content: space-between; }
.ssh-title { font-weight: 600; color: var(--dsw-alias-label-primary); }
.ssh-muted { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.ssh-error { color: var(--dsw-alias-state-error-primary); font-size: 13px; }
.ssh-form { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 12px; background: var(--dsw-alias-bg-layer-2); }
.ssh-field { display: flex; flex-direction: column; gap: 4px; }
.ssh-field > label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.ssh-select { box-sizing: border-box; width: 100%; height: 30px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 13px; appearance: auto; }
.ssh-out { background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 10px; white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 11px; max-height: 240px; overflow: auto; color: var(--dsw-alias-label-primary); }
.ssh-out-error { color: var(--dsw-alias-state-error-primary); }
`;

		async function apiGet(path) {
			const r = await fetch(path)
			return r.json()
		}
		async function apiSend(method, path, body) {
			const r = await fetch(path, {
				method,
				headers: { 'content-type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body),
			})
			return r.json()
		}
		function clean(obj) {
			const out = {}
			for (const key in obj) {
				const v = obj[key]
				if (v !== undefined && v !== null && v !== '') out[key] = v
			}
			return out
		}

		function field(label, value, onChange, extra) {
			return e('div', { className: 'ssh-field' },
				e('label', null, label),
				e(Input, Object.assign({ value: value, onInput: onChange, onChange: onChange }, extra || {})))
		}

		function Section() {
			const [hosts, setHosts] = React.useState([])
			const [error, setError] = React.useState('')
			const [form, setForm] = React.useState(null)
			const [runTarget, setRunTarget] = React.useState('')
			const [runCmd, setRunCmd] = React.useState('hostname && uptime')
			const [runOut, setRunOut] = React.useState(null)
			const [busy, setBusy] = React.useState(false)
			const [txHost, setTxHost] = React.useState('')
			const [txDir, setTxDir] = React.useState('upload')
			const [txLocal, setTxLocal] = React.useState('')
			const [txRemote, setTxRemote] = React.useState('')
			const [txOut, setTxOut] = React.useState(null)

			async function refresh() {
				try {
					const r = await apiGet('/dsh-ssh/api/hosts')
					if (r && r.error) setError(r.error)
					else { setHosts(Array.isArray(r) ? r : []); setError('') }
				} catch (err) { setError(String(err && err.message || err)) }
			}

			React.useEffect(() => { refresh() }, [])

			async function submit() {
				setBusy(true)
				try {
					const payload = clean({
						id: form.id, name: form.name || form.id, host: form.host,
						port: form.port ? Number(form.port) : 22, user: form.user || 'root',
						authType: form.authType || 'agent', keyPath: form.keyPath || '', shell: form.shell || 'auto',
						password: form.password || '', note: form.note || '',
					})
					const r = form._editing
						? await apiSend('POST', '/dsh-ssh/api/hosts/' + encodeURIComponent(form._editing), payload)
						: form._copyOf
							? await apiSend('POST', '/dsh-ssh/api/hosts/' + encodeURIComponent(form._copyOf) + '/copy', payload)
							: await apiSend('POST', '/dsh-ssh/api/hosts', payload)
					if (r && r.error) setError(r.error)
					else { setError(''); setForm(null); await refresh() }
				} catch (err) { setError(String(err && err.message || err)) }
				setBusy(false)
			}

			async function remove(id) {
				if (!window.confirm('Remove host ' + id + '?')) return
				const r = await apiSend('DELETE', '/dsh-ssh/api/hosts/' + encodeURIComponent(id))
				if (r && r.error) setError(r.error)
				else { setError(''); await refresh() }
			}

			async function run() {
				setBusy(true); setRunOut(null)
				try {
					const r = await apiSend('POST', '/dsh-ssh/api/bash', { host: runTarget, command: runCmd, timeoutMs: 60000 })
					setRunOut(r || { error: 'no response' })
				} catch (err) { setRunOut({ error: String(err && err.message || err) }) }
				setBusy(false)
			}

			async function transfer() {
				setBusy(true); setTxOut(null)
				try {
					const body = txDir === 'upload'
						? { host: txHost, localPath: txLocal, remotePath: txRemote }
						: { host: txHost, remotePath: txRemote, localPath: txLocal }
					const r = await apiSend('POST', txDir === 'upload' ? '/dsh-ssh/api/upload' : '/dsh-ssh/api/download', body)
					setTxOut(r || { error: 'no response' })
				} catch (err) { setTxOut({ error: String(err && err.message || err) }) }
				setBusy(false)
			}

			const children = []
			children.push(e('h3', { key: 'h', style: { margin: 0 } }, 'SSH 主机'))
			if (error) children.push(e('div', { key: 'err', className: 'ssh-error' }, error))
			children.push(e('div', { key: 'addrow', className: 'ssh-row' },
				e(Button, { variant: 'primary', onClick: () => setForm({ authType: 'agent', port: 22, user: 'root' }) }, '+ 添加主机'),
				e('span', { className: 'ssh-muted' }, hosts.length + ' 台主机 · 密码明文存储于 ~/.dsh/ssh-hosts.json')))

			if (form) {
				const set = function (k) {
					return function (ev) {
						const next = {}
						for (const key in form) next[key] = form[key]
						next[k] = ev.target.value
						setForm(next)
					}
				}
				const formChildren = [
					field('ID *', form.id || '', set('id'), { disabled: !!form._editing, placeholder: 'build-srv-1' }),
					field('名称', form.name || '', set('name')),
					field('主机/IP *', form.host || '', set('host')),
					field('端口', form.port || '', set('port'), { type: 'number' }),
					field('用户', form.user || '', set('user')),
				]
				formChildren.push(e('div', { className: 'ssh-field' },
					e('label', null, '认证'),
					e('select', { className: 'ssh-select', value: form.authType || 'agent', onChange: set('authType') },
						e('option', { value: 'agent' }, 'agent'),
						e('option', { value: 'key' }, 'key'),
						e('option', { value: 'password' }, 'password'))))
				formChildren.push(field('私钥路径 (key)', form.keyPath || '', set('keyPath'), { placeholder: '~/.ssh/id_ed25519' }))
				if (form._copyOf) {
					formChildren.push(e('div', { key: 'pw', className: 'ssh-field' },
						e('label', null, '密码'),
						e('div', { className: 'ssh-muted', style: { padding: '6px 0' } }, '继承自源主机')))
				} else {
					formChildren.push(field(form._editing ? '密码 (留空保持不变)' : '密码', form.password || '', set('password'), { type: 'password' }))
				}
				formChildren.push(e('div', { className: 'ssh-field' },
					e('label', null, '远端 Shell'),
					e('select', { className: 'ssh-select', value: form.shell || 'auto', onChange: set('shell') },
						e('option', { value: 'auto', title: '优先 bash，无 bash 时回落 sh/ash' }, '自动'),
						e('option', { value: 'bash' }, 'bash'),
						e('option', { value: 'ash' }, 'ash (BusyBox)'),
						e('option', { value: 'sh' }, 'sh'))))
				formChildren.push(field('备注', form.note || '', set('note')))
				formChildren.push(e('div', { key: 'actions', className: 'ssh-row', style: { gridColumn: '1 / -1' } },
					e(Button, { variant: 'primary', disabled: busy || !form.id || !form.host, onClick: submit }, form._editing ? '保存' : form._copyOf ? '复制' : '添加'),
					e(Button, { variant: 'outline', onClick: () => setForm(null) }, '取消')))
				children.push(e('div', { key: 'form', className: 'ssh-form' }, formChildren))
			}

			if (hosts.length === 0 && !form) {
				children.push(e('div', { key: 'empty', className: 'ssh-muted' }, '暂无主机，点击「添加主机」创建。'))
			}

			hosts.forEach(function (h) {
				const card = []
				card.push(e('div', { key: 'head', className: 'ssh-card-head' },
					e('span', { className: 'ssh-title' }, h.name || h.id),
					e('span', { className: 'ssh-muted' }, h.user + '@' + h.host + ':' + h.port + ' · ' + h.authType + ' · shell:' + (h.shell === 'auto' || !h.shell ? '自动' : h.shell) + (h.hasPassword ? ' · 🔑' : ''))))
				if (h.note) card.push(e('div', { key: 'note', className: 'ssh-muted' }, h.note))
				card.push(e('div', { key: 'ops', className: 'ssh-row' },
					e(Button, { variant: 'outline', onClick: () => setForm({ id: h.id + '-copy', name: h.name ? h.name + '-copy' : '', host: h.host, port: h.port, user: h.user, authType: h.authType, keyPath: h.keyPath || '', shell: h.shell || 'auto', note: h.note || '', _copyOf: h.id }) }, '复制'),
					e(Button, { variant: 'outline', onClick: () => setForm({ id: h.id, name: h.name, host: h.host, port: h.port, user: h.user, authType: h.authType, keyPath: h.keyPath || '', shell: h.shell || 'auto', note: h.note || '', _editing: h.id }) }, '编辑'),
					e(Button, { variant: 'ghost', onClick: () => remove(h.id) }, '删除'),
					e(Button, { variant: 'outline', onClick: () => { setRunTarget(h.id); setRunOut(null) } }, '选择运行')))
				children.push(e('div', { key: h.id, className: 'ssh-card' }, card))
			})

			const runChildren = []
			runChildren.push(e('div', { key: 'rt', className: 'ssh-title' }, '远程执行测试'))
			runChildren.push(e('div', { key: 'rr', className: 'ssh-row' },
				e('select', { className: 'ssh-select', value: runTarget, onChange: function (ev) { setRunTarget(ev.target.value) } },
					e('option', { value: '' }, '选择主机…'),
					hosts.map(function (h) { return e('option', { key: h.id, value: h.id }, h.id + ' (' + h.host + ')') })),
				e(Input, { value: runCmd, onInput: function (ev) { setRunCmd(ev.target.value) }, onChange: function (ev) { setRunCmd(ev.target.value) }, style: { flex: 1, minWidth: 200 }, placeholder: 'bash command' }),
				e(Button, { variant: 'outline', disabled: busy || !runTarget, onClick: run }, busy ? '运行中…' : '运行')))
			if (runOut) {
				const text = runOut.error
					? ('ERROR: ' + runOut.error)
					: ('exit=' + runOut.exitCode + (runOut.timedOut ? ' (timeout)' : '') + '\n' + (runOut.stdout || '') + (runOut.stderr ? '\n[stderr]\n' + runOut.stderr : ''))
				runChildren.push(e('div', { key: 'out', className: 'ssh-out' + (runOut.ok === false ? ' ssh-error' : '') }, text))
			}
			children.push(e('div', { key: 'run', className: 'ssh-card' }, runChildren))

			// ── file transfer panel ─────────────────────────────────────────────
			const txChildren = []
			txChildren.push(e('div', { key: 'tt', className: 'ssh-title' }, '文件传输（≤8MB，base64 over ssh）'))
			txChildren.push(e('div', { key: 'tr1', className: 'ssh-row' },
				e('select', { className: 'ssh-select', value: txHost, onChange: function (ev) { setTxHost(ev.target.value) } },
					e('option', { value: '' }, '选择主机…'),
					hosts.map(function (h) { return e('option', { key: h.id, value: h.id }, h.id + ' (' + h.host + ')') })),
				e('select', { className: 'ssh-select', value: txDir, onChange: function (ev) { setTxDir(ev.target.value) } },
					e('option', { value: 'upload' }, '上传：本地 → 远端'),
					e('option', { value: 'download' }, '下载：远端 → 本地')),
				e(Input, { value: txLocal, onInput: function (ev) { setTxLocal(ev.target.value) }, onChange: function (ev) { setTxLocal(ev.target.value) }, style: { flex: 1, minWidth: 180 }, placeholder: txDir === 'upload' ? '本地路径，如 /tmp/a.bin' : '保存到本地路径' }),
				e(Input, { value: txRemote, onInput: function (ev) { setTxRemote(ev.target.value) }, onChange: function (ev) { setTxRemote(ev.target.value) }, style: { flex: 1, minWidth: 180 }, placeholder: txDir === 'upload' ? '远端目标路径' : '远端文件路径，如 /etc/config.conf' }),
				e(Button, { variant: 'primary', disabled: busy || !txHost || !txLocal || !txRemote, onClick: transfer }, busy ? '传输中…' : (txDir === 'upload' ? '上传' : '下载'))))
			if (txOut) {
				const text = txOut.error
					? ('ERROR: ' + txOut.error)
					: (txOut.ok
						? (txOut.direction + ' 完成 · ' + (txOut.bytes === undefined ? '?' : txOut.bytes) + ' 字节 · ' + (txOut.direction === 'upload' ? txOut.remotePath : txOut.localPath))
						: ('失败 exit=' + txOut.exitCode + (txOut.stderr ? '\n' + txOut.stderr : '')))
				txChildren.push(e('div', { key: 'out', className: 'ssh-out' + (txOut.ok === false || txOut.error ? ' ssh-error' : '') }, text))
			}
			children.push(e('div', { key: 'tx', className: 'ssh-card' }, txChildren))

			return e('div', { className: 'ssh-section' }, children)
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
				() => e(Section, null),
			))
		}

		exports.apply = apply;
		return module.exports;
	}
});
