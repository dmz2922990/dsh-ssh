const STORE_NAME = 'ssh-hosts.json'

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

return {
  inject: ['shell', 'fs'],
  apply(ctx) {
    const shell = ctx.shell
    const fs = ctx.fs

    let homeDir = undefined
    let storePath = undefined
    let hosts = null // Array | null (not yet loaded)

    async function ensureHome() {
      if (homeDir !== undefined) return homeDir
      const spec = shell.resolve({ command: 'echo $HOME', timeoutMs: 5000 })
      const result = await shell.run(spec)
      homeDir = (result.stdout && result.stdout.text ? result.stdout.text : '').trim()
      if (!homeDir) homeDir = '/tmp'
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
      } catch (error) {
        hosts = [] // missing file or unreadable: start empty
      }
      return hosts
    }

    async function save() {
      await ensureHome()
      const mkdirSpec = shell.resolve({ command: 'mkdir -p ' + shellQuote(homeDir + '/.dsh'), timeoutMs: 5000 })
      await shell.run(mkdirSpec)
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
        authType: h.auth && h.auth.type ? h.auth.type : 'agent',
        keyPath: h.auth && h.auth.keyPath ? h.auth.keyPath : null,
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
      parts.push('-- bash -s') // script arrives on stdin
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

    async function bashOnHost(ref, command, timeoutMs) {
      const h = await findHost(ref)
      if (!h) {
        const list = await load()
        return {
          ok: false,
          error: 'host not found: ' + ref,
          knownHosts: list.map(publicHost),
        }
      }
      if (h.auth && h.auth.type === 'password' && h.auth.password) await ensureAskpass()
      const sshCommand = buildSshCommand(h)
      const request = {
        command: sshCommand,
        stdin: String(command),
        timeoutMs: Math.min(Math.max(Number(timeoutMs) || 120000, 1000), 600000),
        stdoutMaxBytes: 200000,
      }
      const result = await shell.run(shell.resolve(request))
      return {
        ok: result.exitCode === 0 && !result.timedOut,
        host: h.id,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdout: result.stdout ? result.stdout.text : '',
        stdoutTruncated: !!(result.stdout && result.stdout.truncated),
        stderr: result.stderr ? result.stderr.text : '',
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
        if (patch.host !== undefined) h.host = patch.host
        if (patch.name !== undefined) h.name = patch.name
        if (patch.port !== undefined) h.port = patch.port
        if (patch.user !== undefined) h.user = patch.user
        if (patch.tags !== undefined) h.tags = Array.isArray(patch.tags) ? patch.tags : []
        if (patch.note !== undefined) h.note = patch.note
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
      async bash(ref, command, timeoutMs) { return bashOnHost(ref, command, timeoutMs) },
    }

    ctx.effect(() => ctx.provide('ssh.hosts', service), 'ssh: provide ssh.hosts')

    // Client RPC for the settings page — every value returned is lossless JSON
    ctx.effect(() => harness.handle('ssh.list', async () => {
      try { return await service.list() } catch (err) { return { error: String(err && err.message || err) } }
    }), 'ssh: handle ssh.list')
    ctx.effect(() => harness.handle('ssh.add', async (args) => {
      try {
        return await service.add({
          id: args.id, name: args.name, host: args.host, port: args.port, user: args.user, note: args.note,
          auth: { type: args.authType, keyPath: args.keyPath, password: args.password },
        })
      } catch (err) { return { error: String(err && err.message || err) } }
    }), 'ssh: handle ssh.add')
    ctx.effect(() => harness.handle('ssh.update', async (args) => {
      try {
        const patch = {}
        for (const key of ['host', 'name', 'port', 'user', 'note']) {
          if (args.patch[key] !== undefined) patch[key] = args.patch[key]
        }
        const a = args.patch
        if (a.authType !== undefined || a.keyPath !== undefined || a.password !== undefined) {
          patch.auth = { type: a.authType, keyPath: a.keyPath, password: a.password }
        }
        return await service.update(args.id, patch)
      } catch (err) { return { error: String(err && err.message || err) } }
    }), 'ssh: handle ssh.update')
    ctx.effect(() => harness.handle('ssh.remove', async (args) => {
      try { return { ok: await service.remove(args.id) } } catch (err) { return { error: String(err && err.message || err) } }
    }), 'ssh: handle ssh.remove')
    ctx.effect(() => harness.handle('ssh.bash', async (args) => {
      try { return await bashOnHost(args.host, args.command, args.timeoutMs) } catch (err) { return { error: String(err && err.message || err) } }
    }), 'ssh: handle ssh.bash')

    const jsonOut = {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    }

    const tools = [
      {
        name: 'ssh_host_list',
        description: 'List all managed SSH hosts (id, name, host, port, user, auth type). Passwords are never returned.',
        parameters: {},
        output: jsonOut,
        execute() { return service.list() },
      },
      {
        name: 'ssh_host_add',
        description: 'Add a managed SSH host. auth: {type:"agent"|"key"|"password", keyPath?, password?}. Password auth requires sshpass on this machine and is stored in plain text in ~/.dsh/ssh-hosts.json.',
        parameters: {
          id: { type: 'string', required: true, description: 'Unique host id, e.g. "build-srv-1"' },
          host: { type: 'string', required: true, description: 'Hostname or IP' },
          port: { type: 'number', description: 'SSH port (default 22)' },
          user: { type: 'string', description: 'Login user (default root)' },
          name: { type: 'string', description: 'Optional display name (defaults to id)' },
          authType: { type: 'string', enum: ['agent', 'key', 'password'], description: 'Auth type (default agent)' },
          keyPath: { type: 'string', description: 'Private key path for authType=key' },
          password: { type: 'string', description: 'Password for authType=password (requires sshpass)' },
          note: { type: 'string', description: 'Optional note' },
        },
        output: jsonOut,
        execute(args) {
          return service.add({
            id: args.id, host: args.host, port: args.port, user: args.user, name: args.name, note: args.note,
            auth: { type: args.authType, keyPath: args.keyPath, password: args.password },
          })
        },
      },
      {
        name: 'ssh_host_update',
        description: 'Update an existing managed SSH host by id. Only provided fields change; omit password/keyPath to keep them.',
        parameters: {
          id: { type: 'string', required: true, description: 'Host id to update' },
          host: { type: 'string' },
          port: { type: 'number' },
          user: { type: 'string' },
          name: { type: 'string' },
          authType: { type: 'string', enum: ['agent', 'key', 'password'] },
          keyPath: { type: 'string' },
          password: { type: 'string' },
          note: { type: 'string' },
        },
        output: jsonOut,
        execute(args) {
          const patch = {}
          for (const key of ['host', 'port', 'user', 'name', 'note']) {
            if (args[key] !== undefined) patch[key] = args[key]
          }
          if (args.authType !== undefined || args.keyPath !== undefined || args.password !== undefined) {
            patch.auth = { type: args.authType, keyPath: args.keyPath, password: args.password }
          }
          return service.update(args.id, patch)
        },
      },
      {
        name: 'ssh_host_remove',
        description: 'Remove a managed SSH host by id (or name).',
        parameters: {
          id: { type: 'string', required: true, description: 'Host id or name to remove' },
        },
        output: jsonOut,
        execute(args) { return service.remove(args.id).then((ok) => ({ ok, id: args.id })) },
      },
      {
        name: 'ssh_bash',
        description: 'Run a bash script on a managed SSH host. The script is executed via `bash -s` over SSH with stdin, so multi-line scripts, loops and pipes all work. Reference a host by id, name, or user@host.',
        parameters: {
          host: { type: 'string', required: true, description: 'Host id, name, or user@host from the managed list' },
          command: { type: 'string', required: true, description: 'Bash script to execute remotely' },
          timeoutMs: { type: 'number', description: 'Timeout in ms (default 120000, max 600000)' },
        },
        output: jsonOut,
        execute(args) {
          return bashOnHost(args.host, args.command, args.timeoutMs)
        },
        timeoutMs: 610000,
      },
    ]

    for (const tool of tools) {
      ctx.effect(() => harness.registerTool(ctx, harness.defineTool(tool)), 'ssh: register ' + tool.name)
    }

    console.log('[ssh] service ssh.hosts + tools + settings page registered; store at ~/.dsh/' + STORE_NAME)
  },
}
