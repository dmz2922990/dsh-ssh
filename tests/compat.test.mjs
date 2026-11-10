import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as plugin from '../index.mjs'
import vm from 'node:vm'
import { webcrypto } from 'node:crypto'
import { spawnSync } from 'node:child_process'

const toolNames = ['ssh_host_list', 'ssh_host_add', 'ssh_host_update', 'ssh_host_copy',
  'ssh_host_remove', 'ssh_bash', 'ssh_upload', 'ssh_download']

async function temporaryHome(t) {
  const previous = process.env.DSH_HOME
  const home = await mkdtemp(join(tmpdir(), 'dsh-ssh-test-'))
  process.env.DSH_HOME = home
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  })
  return home
}

function fixture() {
  const tools = new Map()
  const effects = []
  const requests = []
  const ctx = {
    shell: {
      resolve(request) { requests.push(request); return request },
      async execute(spec) {
        assert.equal(spec, requests.at(-1))
        return { async result() {
          return { exitCode: 0, timedOut: false, aborted: false,
            stdout: { text: 'remote output', truncated: false }, stderr: { text: '', truncated: false } }
        } }
      },
    },
    fs: {},
    tools: { register(definition) { tools.set(definition.name, definition) } },
    provide(name, value) { this[name] = value },
    effect(setup) { const dispose = setup(); if (dispose) effects.push(dispose) },
    inject() {},
  }
  plugin.apply(ctx)
  return { ctx, tools, requests, service: ctx['ssh.hosts'], async dispose() {
    for (const dispose of effects.reverse()) await dispose()
  } }
}

test('configuration survives unload and credentials stay private', async (t) => {
  const home = await temporaryHome(t)
  const first = fixture()
  t.after(() => first.dispose())
  assert.deepEqual([...first.tools.keys()], toolNames)
  assert.equal(plugin.inject.includes('webServer'), false)
  await first.service.add({ id: 'build', host: 'example.test', auth: { type: 'password', password: 'secret' } })
  const visible = await first.service.list()
  assert.equal(visible[0].hasPassword, true)
  assert.equal(JSON.stringify(visible).includes('secret'), false)
  await first.service.update('build', { auth: { password: 'replacement' } })
  assert.equal((await first.service.get('build')).authType, 'password')
  const path = join(home, 'ssh-hosts.json')
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  const before = await readFile(path, 'utf8')
  assert.equal(JSON.parse(before).hosts[0].auth.password, 'replacement')
  await first.dispose()
  assert.equal(await readFile(path, 'utf8'), before)
  const second = fixture()
  t.after(() => second.dispose())
  assert.equal((await second.service.list())[0].id, 'build')
})

test('execute/result shell contract preserves stdin, cancellation, and timeout', async (t) => {
  await temporaryHome(t)
  const f = fixture()
  t.after(() => f.dispose())
  await f.service.add({ id: 'build', host: 'example.test' })
  const controller = new AbortController()
  const result = await f.tools.get('ssh_bash').execute({ host: 'build', command: 'echo hello\necho world', timeoutMs: 1234 }, { signal: controller.signal })
  assert.equal(result.ok, true)
  assert.equal(result.stdout, 'remote output')
  const request = f.requests.at(-1)
  assert.equal(request.stdin, 'echo hello\necho world')
  assert.equal(request.timeoutMs, 1234)
  assert.match(request.command, /ssh .*root@example.test/)
  assert.equal(request.signal.aborted, false)
  controller.abort()
  assert.equal(request.signal.aborted, true)
  await f.service.bash('build', 'echo again')
  const active = f.requests.at(-1).signal
  await f.dispose()
  assert.equal(active.aborted, true)
})

test('SSH commands override inherited multiplexing while preserving other SSH configuration', async (t) => {
  const available = spawnSync('ssh', ['-V'], { encoding: 'utf8' })
  if (available.error?.code === 'ENOENT') return t.skip('OpenSSH is required for effective configuration verification')
  const home = await temporaryHome(t)
  const configPath = join(home, 'ssh_config')
  const inheritedSocket = join(home, 'inherited-control-socket')
  await writeFile(configPath, [
    'Host *',
    '  ControlMaster auto',
    '  ControlPath ' + inheritedSocket,
    '  ControlPersist yes',
    '  ServerAliveInterval 19',
    '  IdentityFile ' + join(home, 'identity'),
    '',
  ].join('\n'))
  const settings = (result) => {
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
    return new Map(result.stdout.trim().split('\n').map((line) => {
      const space = line.indexOf(' ')
      return [line.slice(0, space), line.slice(space + 1)]
    }))
  }
  const inherited = settings(spawnSync('ssh', ['-G', '-F', configPath, 'example.test'], { encoding: 'utf8' }))
  assert.equal(inherited.get('controlmaster'), 'auto')
  assert.equal(inherited.get('controlpath'), inheritedSocket)
  assert.equal(inherited.get('controlpersist'), 'yes')

  const f = fixture()
  t.after(() => f.dispose())
  Object.assign(f.ctx.fs, {
    async resolve(path) { return { path } },
    async readBytes() { return Buffer.from('payload') },
    async stat() { return { type: 'file', size: 7 } },
  })
  await f.service.add({ id: 'build', host: 'example.test', user: 'runner', port: 2222 })
  await f.service.bash('build', 'echo connected')
  await f.service.upload('build', join(home, 'local.bin'), '/tmp/remote.bin')
  await f.service.download('build', '/tmp/remote.bin', join(home, 'download.bin'))
  assert.equal(f.requests.length, 3)
  for (const [index, request] of f.requests.entries()) {
    const prefix = request.command.match(/\b(ssh .*?) -- /)?.[1]
    assert.ok(prefix, 'operation ' + index + ' must execute SSH')
    const effective = settings(spawnSync('/bin/sh', [
      '-c', 'exec ' + prefix.replace(/^ssh /, 'ssh -G -F "$1" '), 'ssh-config-test', configPath,
    ], { encoding: 'utf8' }))
    assert.equal(effective.get('controlmaster'), 'false')
    assert.equal(effective.get('controlpath'), undefined)
    assert.equal(effective.get('controlpersist'), 'no')
    assert.equal(effective.get('serveraliveinterval'), '19')
    assert.equal(effective.get('identityfile'), join(home, 'identity'))
    assert.equal(effective.get('user'), 'runner')
    assert.equal(effective.get('port'), '2222')
  }
})

test('corrupt configuration is reported and never overwritten', async (t) => {
  const home = await temporaryHome(t)
  const path = join(home, 'ssh-hosts.json')
  const broken = '{broken configuration'
  await writeFile(path, broken)
  const f = fixture()
  t.after(() => f.dispose())
  await assert.rejects(f.service.list(), SyntaxError)
  await assert.rejects(f.service.add({ id: 'build', host: 'example.test' }))
  assert.equal(await readFile(path, 'utf8'), broken)
})

test('concurrent writes persist all hosts and invalid edits roll back', async (t) => {
  const home = await temporaryHome(t)
  const f = fixture()
  t.after(() => f.dispose())
  await Promise.all(Array.from({ length: 8 }, (_, index) =>
    f.service.add({ id: 'host-' + index, host: 'example.test' })))
  assert.equal(JSON.parse(await readFile(join(home, 'ssh-hosts.json'), 'utf8')).hosts.length, 8)
  await assert.rejects(f.service.update('host-0', { port: 70000 }), /port/)
  assert.equal((await f.service.get('host-0')).port, 22)
})

const runtimeRoot = process.env.DSH_RUNTIME_DIR
let runtime
if (runtimeRoot) {
  const scoped = runtimeRoot.endsWith('@deepseek-ai') ? runtimeRoot : join(runtimeRoot, '@deepseek-ai')
  const [cordis, tools, connection] = await Promise.all([
    import(pathToFileURL(resolve(scoped, 'cordis/lib/index.js'))),
    import(pathToFileURL(resolve(scoped, 'dsh-tools/lib/index.js'))),
    import(pathToFileURL(resolve(scoped, 'dsh-client-connection/lib/index.js'))),
  ])
  runtime = { Context: cordis.Context, Service: cordis.Service, Tools: tools.default, Connection: connection.HostConnectionService, scoped }
}

test('Desktop Cordis and Tools unload and reload every registration without a web server', {
  skip: runtime ? false : 'Set DSH_RUNTIME_DIR to a Harness node_modules directory',
}, async (t) => {
  const home = await temporaryHome(t)
  const root = new runtime.Context()
  t.after(() => root.fiber.dispose())
  root.provide('systemPrompt', { tools() {} })
  root.provide('shell', fixture().ctx.shell)
  root.provide('fs', {})
  await root.plugin(runtime.Tools, {})
  const first = await root.plugin(plugin)
  for (const name of toolNames) assert.ok(root.tools.get(name), name)
  assert.ok(root.get('ssh.hosts'))
  await root.get('ssh.hosts').add({ id: 'persisted', host: 'example.test' })
  await first.dispose()
  for (const name of toolNames) assert.equal(root.tools.get(name), undefined, name)
  assert.equal(root.get('ssh.hosts'), undefined)
  assert.equal(JSON.parse(await readFile(join(home, 'ssh-hosts.json'), 'utf8')).hosts.length, 1)
  const second = await root.plugin(plugin)
  assert.equal((await root.get('ssh.hosts').list())[0].id, 'persisted')
  for (const name of toolNames) assert.ok(root.tools.get(name), name)
  await second.dispose()
})


test('real Desktop Connection carrier handles settings, owner access, unload and reload', {
  skip: runtime ? false : 'Set DSH_RUNTIME_DIR to a Harness node_modules directory',
}, async (t) => {
  await temporaryHome(t)
  const root = new runtime.Context()
  t.after(() => root.fiber.dispose())
  root.provide('systemPrompt', { tools() {} })
  root.provide('shell', fixture().ctx.shell)
  root.provide('fs', {})
  await root.plugin(runtime.Tools, {})
  await root.plugin((ctx) => {
    new runtime.Connection(ctx, [], { isAuthenticated: () => true })
  })
  const connection = root.get('connection')
  const carrier = connection.createSharedFetchHandler('/api')
  const owner = { principal: { kind: 'owner' } }
  const guest = { principal: { kind: 'guest' } }
  let clientModule
  const clientSource = await readFile(join(runtime.scoped, 'dsh-client-connection/lib/client.browser.js'), 'utf8')
  vm.runInNewContext(clientSource, {
    window: { __ModuleLoader__: { load({ factory }) { clientModule = factory() } } },
    crypto: webcrypto, URL, Request, Response, Blob, FormData, TextDecoder, AbortController,
  })
  let client
  const requests = []
  clientModule.installConnection({ provide(name, value) { client = value } }, {
    transport: { fetch(input, init) {
      requests.push(input)
      return carrier.fetch(new Request(new URL(input, 'http://127.0.0.1/'), init), owner)
    } },
  })
  const invoke = (payload) => client.rpc.call('/api', 'dsh-ssh/request', payload)
  const first = await root.plugin(plugin)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(JSON.parse(JSON.stringify(await invoke({ method: 'GET', path: '/hosts' }))), { ok: true, value: [] })
  assert.equal(requests[0], 'api/dsh-ssh/request')
  const denied = await carrier.fetch(new Request('http://127.0.0.1/api/dsh-ssh/request', {
    method: 'POST', body: '{}',
  }), guest)
  assert.equal(denied.status, 403)
  assert.equal((await invoke({ method: 'POST', path: '/hosts', body: {
    id: 'web-host', host: 'example.test', authType: 'password', password: 'private-secret',
  } })).ok, true)
  const visible = await invoke({ method: 'GET', path: '/hosts' })
  assert.equal(visible.value[0].hasPassword, true)
  assert.equal(JSON.stringify(visible).includes('private-secret'), false)
  assert.equal((await invoke({ method: 'POST', path: '/hosts/web-host', body: { password: 'updated-secret' } })).value.authType, 'password')
  assert.equal((await invoke({ method: 'POST', path: '/hosts/web-host/copy', body: { id: 'copy', host: 'copy.test' } })).value.id, 'copy')
  assert.equal((await invoke({ method: 'DELETE', path: '/hosts/copy' })).value.ok, true)
  await first.dispose()
  await assert.rejects(invoke({ method: 'GET', path: '/hosts' }), /HTTP 404/)
  const second = await root.plugin(plugin)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal((await invoke({ method: 'GET', path: '/hosts' })).value[0].id, 'web-host')
  await second.dispose()
  await assert.rejects(invoke({ method: 'GET', path: '/hosts' }), /HTTP 404/)
})
