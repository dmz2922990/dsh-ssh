return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    ctx.effect(() => styles.insert(`
.sshm-section { display: flex; flex-direction: column; gap: 16px; font-size: 13px; }
.sshm-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.sshm-card { border: 1px solid rgba(128,128,128,.4); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.sshm-card-head { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.sshm-title { font-weight: 600; }
.sshm-muted { opacity: 0.65; }
.sshm-form { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; border: 1px dashed rgba(128,128,128,.5); border-radius: 8px; padding: 12px; }
.sshm-field { display: flex; flex-direction: column; gap: 3px; }
.sshm-field label { font-size: 11px; opacity: 0.75; }
.sshm-field input, .sshm-field select, .sshm-row input, .sshm-row select { padding: 4px 6px; border: 1px solid rgba(128,128,128,.5); border-radius: 4px; background: transparent; color: inherit; font-size: 12px; }
.sshm-btn { padding: 4px 10px; border-radius: 5px; border: 1px solid rgba(128,128,128,.6); background: transparent; color: inherit; cursor: pointer; font-size: 12px; }
.sshm-btn:hover { opacity: 0.85; }
.sshm-btn-primary { border-color: transparent; background: #3a9; color: #fff; }
.sshm-btn-danger { border-color: #c55; color: #e77; }
.sshm-out { background: rgba(128,128,128,.12); border-radius: 6px; padding: 8px; white-space: pre-wrap; font-family: monospace; font-size: 11px; max-height: 220px; overflow: auto; }
.sshm-error { color: #e77; }
`), 'ssh settings css')

    const e = React.createElement

    function clean(obj) {
      const out = {}
      for (const key in obj) {
        const v = obj[key]
        if (v !== undefined && v !== null && v !== '') out[key] = v
      }
      return out
    }

    function input(label, value, onChange, extra) {
      return e('div', { className: 'sshm-field' },
        e('label', null, label),
        e('input', Object.assign({ value: value, onChange: onChange }, extra || {})))
    }

    function Section() {
      const [hosts, setHosts] = React.useState([])
      const [error, setError] = React.useState('')
      const [form, setForm] = React.useState(null)
      const [runTarget, setRunTarget] = React.useState('')
      const [runCmd, setRunCmd] = React.useState('hostname && uptime')
      const [runOut, setRunOut] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      async function refresh() {
        try {
          const r = await host.call('ssh.list')
          if (r && r.error) setError(r.error)
          else { setHosts(r || []); setError('') }
        } catch (err) { setError(String(err && err.message || err)) }
      }

      React.useEffect(() => { refresh() }, [])

      async function submit() {
        setBusy(true)
        try {
          const payload = clean({
            id: form.id, name: form.name || form.id, host: form.host,
            port: form.port ? Number(form.port) : 22, user: form.user || 'root',
            authType: form.authType || 'agent', keyPath: form.keyPath || '',
            password: form.password || '', note: form.note || '',
          })
          const r = form._editing
            ? await host.call('ssh.update', clean({ id: form._editing, patch: payload }))
            : await host.call('ssh.add', payload)
          if (r && r.error) setError(r.error)
          else { setError(''); setForm(null); await refresh() }
        } catch (err) { setError(String(err && err.message || err)) }
        setBusy(false)
      }

      async function remove(id) {
        if (!window.confirm('Remove host ' + id + '?')) return
        const r = await host.call('ssh.remove', { id: id })
        if (r && r.error) setError(r.error)
        else { setError(''); await refresh() }
      }

      async function run() {
        setBusy(true); setRunOut(null)
        try {
          const r = await host.call('ssh.bash', { host: runTarget, command: runCmd, timeoutMs: 60000 })
          setRunOut(r || { error: 'no response' })
        } catch (err) { setRunOut({ error: String(err && err.message || err) }) }
        setBusy(false)
      }

      const children = []
      children.push(e('h3', { key: 'h', style: { margin: 0 } }, 'SSH 主机'))
      if (error) children.push(e('div', { key: 'err', className: 'sshm-error' }, error))
      children.push(e('div', { key: 'addrow', className: 'sshm-row' },
        e('button', { className: 'sshm-btn sshm-btn-primary', onClick: () => setForm({ authType: 'agent', port: 22, user: 'root' }) }, '+ 添加主机'),
        e('span', { className: 'sshm-muted' }, hosts.length + ' 台主机 · 密码明文存储于 ~/.dsh/ssh-hosts.json')))

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
          input('ID *', form.id || '', set('id'), { disabled: !!form._editing, placeholder: 'build-srv-1' }),
          input('名称', form.name || '', set('name')),
          input('主机/IP *', form.host || '', set('host')),
          input('端口', form.port || '', set('port'), { type: 'number' }),
          input('用户', form.user || '', set('user')),
        ]
        formChildren.push(e('div', { className: 'sshm-field' },
          e('label', null, '认证'),
          e('select', { value: form.authType || 'agent', onChange: set('authType') },
            e('option', { value: 'agent' }, 'agent'),
            e('option', { value: 'key' }, 'key'),
            e('option', { value: 'password' }, 'password'))))
        formChildren.push(input('私钥路径 (key)', form.keyPath || '', set('keyPath'), { placeholder: '~/.ssh/id_ed25519' }))
        formChildren.push(input(form._editing ? '密码 (留空保持不变)' : '密码', form.password || '', set('password'), { type: 'password' }))
        formChildren.push(input('备注', form.note || '', set('note')))
        formChildren.push(e('div', { key: 'actions', className: 'sshm-row', style: { gridColumn: '1 / -1' } },
          e('button', { className: 'sshm-btn sshm-btn-primary', disabled: busy || !form.id || !form.host, onClick: submit }, form._editing ? '保存' : '添加'),
          e('button', { className: 'sshm-btn', onClick: () => setForm(null) }, '取消')))
        children.push(e('div', { key: 'form', className: 'sshm-form' }, formChildren))
      }

      if (hosts.length === 0 && !form) {
        children.push(e('div', { key: 'empty', className: 'sshm-muted' }, '暂无主机，点击「添加主机」创建。'))
      }

      hosts.forEach(function (h) {
        const card = []
        card.push(e('div', { key: 'head', className: 'sshm-card-head' },
          e('span', { className: 'sshm-title' }, h.name || h.id),
          e('span', { className: 'sshm-muted' }, h.user + '@' + h.host + ':' + h.port + ' · ' + h.authType + (h.hasPassword ? ' · 🔑' : ''))))
        if (h.note) card.push(e('div', { key: 'note', className: 'sshm-muted' }, h.note))
        card.push(e('div', { key: 'ops', className: 'sshm-row' },
          e('button', { className: 'sshm-btn', onClick: () => setForm({ id: h.id, name: h.name, host: h.host, port: h.port, user: h.user, authType: h.authType, keyPath: h.keyPath || '', note: h.note || '', _editing: h.id }) }, '编辑'),
          e('button', { className: 'sshm-btn sshm-btn-danger', onClick: () => remove(h.id) }, '删除'),
          e('button', { className: 'sshm-btn', onClick: () => { setRunTarget(h.id); setRunOut(null) } }, '选择运行')))
        children.push(e('div', { key: h.id, className: 'sshm-card' }, card))
      })

      const runChildren = []
      runChildren.push(e('div', { key: 'rt', className: 'sshm-title' }, '远程执行测试'))
      runChildren.push(e('div', { key: 'rr', className: 'sshm-row' },
        e('select', { value: runTarget, onChange: function (ev) { setRunTarget(ev.target.value) } },
          e('option', { value: '' }, '选择主机…'),
          hosts.map(function (h) { return e('option', { key: h.id, value: h.id }, h.id + ' (' + h.host + ')') })),
        e('input', { value: runCmd, onChange: function (ev) { setRunCmd(ev.target.value) }, style: { flex: 1, minWidth: 200 }, placeholder: 'bash command' }),
        e('button', { className: 'sshm-btn', disabled: busy || !runTarget, onClick: run }, busy ? '运行中…' : '运行')))
      if (runOut) {
        const text = runOut.error
          ? ('ERROR: ' + runOut.error)
          : ('exit=' + runOut.exitCode + (runOut.timedOut ? ' (timeout)' : '') + '\n' + (runOut.stdout || '') + (runOut.stderr ? '\n[stderr]\n' + runOut.stderr : ''))
        runChildren.push(e('div', { key: 'out', className: 'sshm-out' + (runOut.ok === false ? ' sshm-error' : '') }, text))
      }
      children.push(e('div', { key: 'run', className: 'sshm-card' }, runChildren))

      return e('div', { className: 'sshm-section' }, children)
    }

    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'ssh-hosts', order: 60, label: 'SSH 主机' },
      () => e(Section, null),
    ))
  },
}
