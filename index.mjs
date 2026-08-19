// dsh-ssh host half: SSH host inventory + remote bash tools + web API for the
// settings page. Pure Node, no external dependencies.
//
// Hosts persist in ~/.dsh/ssh-hosts.json. Password auth uses SSH_ASKPASS
// (no pty, no sshpass) so it works inside the harness command sandbox.
// The browser settings page is served by webapi.mjs (separate entry with a
// hard `webServer` inject; services are not visible via ctx.get at apply time).

const STORE_NAME = 'ssh-hosts.json'

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

function jsonOut() {
  return {
    schema: {},
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  }
}

export const inject = ['shell', 'fs', 'tools']

export function apply(ctx) {
  const shell = ctx.shell
  const fs = ctx.fs

  let homeDir
  let storePath
  let hosts = null

  async function ensureHome() {
    if (homeDir !== undefined) return homeDir
    const spec = shell.resolve({ command: 'echo $HOME', timeoutMs: 5000 })
    const result = await shell.run(spec)
    homeDir = ((result.stdout && result.stdout.text) || '').trim() || '/tmp'
    storePath = homeDir + '/.dsh/' + STORE_NAME
    return homeDir
  }

  async function ensureAskpass() {
    await ensureHome()
    const path = homeDir + '/.dsh/.ssh-askpass.sh'
    const setup = 'test -x ' + shellQuote(path) + ' || { mkdir -p ' + shellQuote(homeDir + '/.dsh')
      + '; echo ' + shellQuote('#!/bin/sh')
      + ' > ' + shellQuote(path) + '; echo ' + shellQuote('printf \'%s\\n\' "$SSHPASS_ENV"')
      + ' >> ' + shellQuote(path) + '; chmod 700 ' + shellQuote(path) + '; }'
    await shell.run(shell.resolve({ command: setup, timeoutMs: 5000 }))
    return path
  }

  async function load() {
    if (hosts !== null) return hosts
    await ensureHome()
    hosts = []
    try {
      const target = await fs.resolve(storePath)
      const text = await fs.readText(target)
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed.hosts)) hosts = parsed.hosts.filter((h) => h && typeof h.id === 'string')
    } catch {
      hosts = []
    }
    return hosts
  }

  async function save() {
    await ensureHome()
    await shell.run(shell.resolve({
      command: 'mkdir -p ' + shellQuote(homeDir + '/.dsh'),
      timeoutMs: 5000,
    }))
    const target = await fs.resolve(storePath)
    await fs.writeText(target, JSON.stringify({ version: 1, hosts }, null, 2))
  }

  function publicHost(h) {
    return {
      id: h.id,
      name: h.name === undefined ? null : h.name,
      host: h.host,
      port: h.port || 22,
      user: h.user || 'root',
      authType: (h.auth && h.auth.type) || 'agent',
      shell: h.shell || 'bash',
      keyPath: (h.auth && h.auth.keyPath) || null,
      hasPassword: !!(h.auth && h.auth.password),
      tags: Array.isArray(h.tags) ? h.tags : [],
      note: h.note === undefined ? null : h.note,
    }
  }

  function normalizeAuth(auth) {
    if (!auth) return { type: 'agent' }
    const type = auth.type === 'password' || auth.type === 'key' ? auth.type : 'agent'
    return { type, keyPath: auth.keyPath, password: auth.password }
  }

  function buildSshCommand(h) {
    const auth = normalizeAuth(h.auth)
    const parts = []
    if (auth.type === 'password' && auth.password) {
      parts.push('SSHPASS_ENV=' + shellQuote(auth.password))
      parts.push('SSH_ASKPASS="' + homeDir + '/.dsh/.ssh-askpass.sh"')
      parts.push('SSH_ASKPASS_REQUIRE=force')
      parts.push('DISPLAY=:')
    }
    parts.push('ssh')
    parts.push('-o StrictHostKeyChecking=accept-new')
    parts.push('-o ConnectTimeout=15')
    if (auth.type !== 'password') parts.push('-o BatchMode=yes')
    if (auth.keyPath) parts.push('-i ' + shellQuote(auth.keyPath))
    parts.push('-p ' + String(h.port || 22))
    parts.push(shellQuote((h.user || 'root') + '@' + h.host))
    parts.push('-- ' + shellQuote(h.shell || 'bash') + ' -s')
    return parts.join(' ')
  }

  async function findHost(ref) {
    const list = await load()
    const lower = String(ref).toLowerCase()
    return list.find((h) => h.id === ref
      || (h.name && h.name.toLowerCase() === lower)
      || ((h.user || 'root') + '@' + h.host).toLowerCase() === lower
      || h.host.toLowerCase() === lower)
  }

  async function bashOnHost(ref, command, timeoutMs, signal, shellOverride) {
    const h = await findHost(ref)
    if (!h) {
      return { ok: false, error: 'host not found: ' + ref, knownHosts: (await load()).map(publicHost) }
    }
    if (h.auth && h.auth.type === 'password' && h.auth.password) await ensureAskpass()
    const runHost = shellOverride !== undefined ? Object.assign({}, h, { shell: shellOverride }) : h
    const request = {
      command: buildSshCommand(runHost),
      stdin: String(command),
      timeoutMs: Math.min(Math.max(Number(timeoutMs) || 120000, 1000), 600000),
      stdoutMaxBytes: 200000,
      ...(signal ? { signal } : {}),
    }
    const result = await shell.run(shell.resolve(request))
    return {
      ok: result.exitCode === 0 && !result.timedOut,
      host: h.id,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdout: (result.stdout && result.stdout.text) || '',
      stdoutTruncated: !!(result.stdout && result.stdout.truncated),
      stderr: (result.stderr && result.stderr.text) || '',
      stderrTruncated: !!(result.stderr && result.stderr.truncated),
    }
  }

  const service = {
    async list() { return (await load()).map(publicHost) },
    async get(ref) { const h = await findHost(ref); return h ? publicHost(h) : null },
    async add(input) {
      if (!input || !input.id || !input.host) throw new Error('add requires id and host')
      const list = await load()
      if (list.some((h) => h.id === input.id || (input.name && h.name === input.name))) {
        throw new Error('host id/name already exists: ' + input.id)
      }
      const h = {
        id: input.id,
        name: input.name || input.id,
        host: input.host,
        port: input.port || 22,
        user: input.user || 'root',
        shell: input.shell,
        auth: normalizeAuth(input.auth),
        tags: Array.isArray(input.tags) ? input.tags : [],
        note: input.note,
      }
      list.push(h)
      await save()
      return publicHost(h)
    },
    async update(id, patch) {
      const list = await load()
      const h = list.find((x) => x.id === id)
      if (!h) throw new Error('host not found: ' + id)
      for (const key of ['host', 'name', 'port', 'user', 'note', 'shell']) {
        if (patch[key] !== undefined) h[key] = patch[key]
      }
      if (patch.tags !== undefined) h.tags = Array.isArray(patch.tags) ? patch.tags : []
      if (patch.auth !== undefined) {
        const next = normalizeAuth(patch.auth)
        if (next.keyPath === undefined && h.auth) next.keyPath = h.auth.keyPath
        if (next.password === undefined && h.auth) next.password = h.auth.password
        h.auth = next
      }
      await save()
      return publicHost(h)
    },
    async remove(id) {
      const list = await load()
      const idx = list.findIndex((x) => x.id === id || (x.name && x.name === id))
      if (idx < 0) return false
      list.splice(idx, 1)
      await save()
      return true
    },
    async bash(ref, command, timeoutMs, shell) { return bashOnHost(ref, command, timeoutMs, undefined, shell) },
  }

  ctx.provide('ssh.hosts', service)

  // ── model tools ───────────────────────────────────────────────────────────

  const S = (description) => ({ type: 'string', description })

  ctx.tools.register({
    name: 'ssh_host_list',
    description: 'List all managed SSH hosts (id, name, host, port, user, auth type). Passwords are never returned.',
    parameters: { type: 'object', properties: {} },
    output: jsonOut(),
    execute() { return service.list() },
  })

  ctx.tools.register({
    name: 'ssh_host_add',
    description: 'Add a managed SSH host. authType: agent | key | password. Password auth uses a local SSH_ASKPASS helper; the password is stored in plain text in ~/.dsh/ssh-hosts.json.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique host id, e.g. "build-srv-1"' },
        host: { type: 'string', description: 'Hostname or IP' },
        port: { type: 'number', description: 'SSH port (default 22)' },
        user: { type: 'string', description: 'Login user (default root)' },
        name: { type: 'string', description: 'Optional display name (defaults to id)' },
        authType: { type: 'string', enum: ['agent', 'key', 'password'], description: 'Auth type (default agent)' },
        keyPath: { type: 'string', description: 'Private key path for authType=key' },
        password: { type: 'string', description: 'Password for authType=password' },
        note: { type: 'string', description: 'Optional note' },
        shell: { type: 'string', description: "Remote shell for scripts (default 'bash'; use 'ash'/'sh' on BusyBox/embedded devices)" },
      },
      required: ['id', 'host'],
    },
    output: jsonOut(),
    execute(args) {
      return service.add({
        id: args.id, host: args.host, port: args.port, user: args.user, name: args.name, note: args.note, shell: args.shell,
        auth: { type: args.authType, keyPath: args.keyPath, password: args.password },
      })
    },
  })

  ctx.tools.register({
    name: 'ssh_host_update',
    description: 'Update an existing managed SSH host by id. Only provided fields change; omit password/keyPath to keep them.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Host id to update' },
        host: S('Hostname or IP'),
        port: { type: 'number', description: 'SSH port' },
        user: S('Login user'),
        name: S('Display name'),
        authType: { type: 'string', enum: ['agent', 'key', 'password'], description: 'Auth type' },
        keyPath: S('Private key path'),
        password: S('Password (leave out to keep the current one)'),
        note: S('Note'),
        shell: S("Remote shell (default 'bash'; use 'ash'/'sh' on BusyBox devices)"),
      },
      required: ['id'],
    },
    output: jsonOut(),
    execute(args) {
      const patch = {}
      for (const key of ['host', 'port', 'user', 'name', 'note', 'shell']) {
        if (args[key] !== undefined) patch[key] = args[key]
      }
      if (args.authType !== undefined || args.keyPath !== undefined || args.password !== undefined) {
        patch.auth = { type: args.authType, keyPath: args.keyPath, password: args.password }
      }
      return service.update(args.id, patch)
    },
  })

  ctx.tools.register({
    name: 'ssh_host_remove',
    description: 'Remove a managed SSH host by id (or name).',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Host id or name to remove' } },
      required: ['id'],
    },
    output: jsonOut(),
    execute(args) { return service.remove(args.id).then((ok) => ({ ok, id: args.id })) },
  })

  ctx.tools.register({
    name: 'ssh_bash',
    description: 'Run a bash script on a managed SSH host. The script is executed via `<shell> -s` over SSH (default bash; set the host shell or the shell param to ash/sh on BusyBox devices) with stdin, so multi-line scripts, loops and pipes all work. Reference a host by id, name, or user@host.',
    parameters: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Host id, name, or user@host from the managed list' },
        command: { type: 'string', description: 'Bash script to execute remotely' },
        timeoutMs: { type: 'number', description: 'Timeout in ms (default 120000, max 600000)' },
        shell: { type: 'string', description: "Remote shell to run the script with (default: the host's configured shell, fallback 'bash'; use 'ash' or 'sh' on BusyBox/embedded devices)" },
      },
      required: ['host', 'command'],
    },
    output: jsonOut(),
    timeoutMs: 610000,
    execute(args, exec) { return bashOnHost(args.host, args.command, args.timeoutMs, exec && exec.signal, args.shell) },
  })

  ctx.logger?.info?.('dsh-ssh: ssh.hosts service and ssh_* tools registered')
}
