import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

function browserFixture() {
  const styles = new Set()
  const states = []
  const effects = []
  let stateIndex = 0
  let mounted = false
  let plugin
  const react = {
    createElement(type, props, ...children) { return { type, props, children: children.flat(Infinity) } },
    useState(initial) {
      const index = stateIndex++
      if (!(index in states)) states[index] = initial
      return [states[index], (value) => { states[index] = value }]
    },
    useEffect(effect) { if (!mounted) effects.push(effect) },
  }
  runInNewContext(source, {
    window: { confirm: () => true, __ModuleLoader__: {
      load(definition) {
        assert.equal(definition.id, 'dsh-ssh')
        plugin = definition.factory((name) => {
          if (name === 'react') return react
          throw new Error('unexpected browser dependency: ' + name)
        })
      },
    } },
    document: {
      createElement(name) {
        assert.equal(name, 'style')
        const style = { textContent: '', remove() { styles.delete(style) } }
        return style
      },
      head: { appendChild(style) { styles.add(style) } },
    },
    fetch() { assert.fail('settings must use Harness Connection RPC') },
  }, { filename: 'client.js' })
  return {
    plugin, styles,
    async render(element) {
      stateIndex = 0
      const tree = element.type(element.props)
      for (const effect of effects.splice(0)) effect()
      mounted = true
      await new Promise((resolve) => setImmediate(resolve))
      return tree
    },
  }
}

function elements(tree) {
  return [tree, ...(tree.children || []).filter((child) => child && typeof child === 'object').flatMap(elements)]
}

function mount(browser, call) {
  const registrations = new Map()
  const disposers = []
  const connection = { rpc: { call } }
  const slots = {
    inject(name, setup) {
      assert.equal(name, 'settings.section')
      disposers.push(setup())
    },
    register(options, render) {
      assert.equal(registrations.has(options.id), false)
      registrations.set(options.id, { options, render })
      return () => registrations.delete(options.id)
    },
  }
  browser.plugin.apply({
    connection,
    get(name) { assert.equal(name, 'slots'); return slots },
    effect(setup) { disposers.push(setup()) },
  })
  return {
    registrations, connection,
    section: () => registrations.get('ssh-hosts').render(),
    dispose() { for (const dispose of disposers.splice(0).reverse()) dispose() },
  }
}

test('browser bundle declares services and releases settings and CSS before reload', () => {
  const browser = browserFixture()
  assert.deepEqual(Array.from(browser.plugin.inject), ['slots', 'connection'])
  const call = async () => ({ ok: true, value: [] })
  const first = mount(browser, call)
  assert.equal(first.registrations.size, 1)
  assert.equal(first.registrations.get('ssh-hosts').options.name, 'settings.section')
  assert.equal(first.section().props.connection, first.connection)
  assert.equal(browser.styles.size, 1)
  assert.match([...browser.styles][0].textContent, /\.ssh-section/)
  first.dispose()
  assert.equal(first.registrations.size, 0)
  assert.equal(browser.styles.size, 0)
  const second = mount(browser, call)
  assert.equal(second.registrations.size, 1)
  assert.equal(browser.styles.size, 1)
  second.dispose()
  assert.equal(second.registrations.size, 0)
  assert.equal(browser.styles.size, 0)
})

test('settings load and delete hosts over Connection RPC with encoded identifiers', async (t) => {
  const browser = browserFixture()
  const calls = []
  let hosts = [{ id: 'lab/a b', host: 'example.test', user: 'root', port: 22, authType: 'agent' }]
  const mounted = mount(browser, async (...args) => {
    calls.push(JSON.parse(JSON.stringify(args)))
    const [channel, endpoint, payload] = args
    assert.equal(channel, '/api')
    assert.equal(endpoint, 'dsh-ssh/request')
    if (payload.method === 'DELETE') {
      hosts = []
      return { ok: true, value: { ok: true } }
    }
    return { ok: true, value: hosts }
  })
  t.after(() => mounted.dispose())
  const section = mounted.section()
  await browser.render(section)
  assert.deepEqual(calls[0], ['/api', 'dsh-ssh/request', { method: 'GET', path: '/hosts' }])
  const tree = await browser.render(section)
  const remove = elements(tree).find((node) => node.type === 'button' && node.children.includes('删除'))
  assert.ok(remove, 'loaded hosts must appear in the settings page')
  await remove.props.onClick()
  assert.deepEqual(calls[1], ['/api', 'dsh-ssh/request', { method: 'DELETE', path: '/hosts/lab%2Fa%20b' }])
  assert.deepEqual(calls[2], ['/api', 'dsh-ssh/request', { method: 'GET', path: '/hosts' }])
  const empty = await browser.render(section)
  assert.ok(elements(empty).some((node) => node.children.includes('暂无主机，点击「添加主机」创建。')))
})

function button(tree, label) {
  const found = elements(tree).find((node) => node.type === 'button' && node.children.includes(label))
  assert.ok(found, 'missing button: ' + label)
  return found
}

function control(tree, label) {
  const field = elements(tree).find((node) => node.type === 'label'
    && node.children.some((child) => child?.type === 'span' && child.children.includes(label)))
  assert.ok(field, 'missing field: ' + label)
  return field.children.find((child) => ['input', 'textarea', 'select'].includes(child?.type))
}

async function page(t, hosts = []) {
  const browser = browserFixture()
  const calls = []
  const mounted = mount(browser, async (channel, endpoint, payload) => {
    assert.equal(channel, '/api')
    assert.equal(endpoint, 'dsh-ssh/request')
    calls.push(JSON.parse(JSON.stringify(payload)))
    return { ok: true, value: payload.method === 'GET' ? hosts : { ok: true, exitCode: 0, stdout: 'connected', bytes: 12 } }
  })
  t.after(() => mounted.dispose())
  const section = mounted.section()
  await browser.render(section)
  let tree = await browser.render(section)
  return {
    calls,
    get tree() { return tree },
    async click(label) {
      await button(tree, label).props.onClick()
      tree = await browser.render(section)
    },
    async change(label, value) {
      control(tree, label).props.onChange({ target: { value } })
      tree = await browser.render(section)
    },
    async submit() {
      const form = elements(tree).find((node) => node.type === 'form')
      assert.ok(form)
      await form.props.onSubmit({ preventDefault() {} })
      tree = await browser.render(section)
    },
  }
}

const savedHost = { id: 'lab/a b', name: 'Lab', host: 'example.test', user: 'root', port: 22,
  authType: 'password', hasPassword: true, note: 'old note', shell: 'ash' }

test('default view shows hosts and reveals connection tools only when selected', async (t) => {
  const ui = await page(t, [savedHost])
  assert.equal(elements(ui.tree).filter((node) => node.type === 'article').length, 1)
  assert.equal(elements(ui.tree).some((node) => node.type === 'textarea'), false)
  assert.equal(elements(ui.tree).some((node) => node.type === 'form'), false)
  await ui.click('连接工具')
  assert.ok(control(ui.tree, '远程命令'))
  assert.equal(elements(ui.tree).some((node) => node.type === 'article'), false)
  assert.equal(button(ui.tree, '主机管理').props['aria-current'], undefined)
  await ui.click('主机管理')
  assert.equal(elements(ui.tree).some((node) => node.type === 'textarea'), false)
})

test('new host form groups connection and authentication with conditional credential fields', async (t) => {
  const ui = await page(t)
  await ui.click('+ 添加主机')
  for (const label of ['连接信息', '身份认证']) {
    assert.ok(elements(ui.tree).some((node) => node.type === 'h4' && node.children.includes(label)))
  }
  assert.equal(control(ui.tree, '认证方式').props.value, 'agent')
  assert.equal(elements(ui.tree).some((node) => node.props?.type === 'password'), false)
  assert.equal(elements(ui.tree).some((node) => node.props?.placeholder === '~/.ssh/id_ed25519'), false)
  await ui.change('认证方式', 'key')
  assert.equal(control(ui.tree, '私钥文件路径').props.required, true)
  assert.equal(elements(ui.tree).some((node) => node.props?.type === 'password'), false)
  await ui.change('认证方式', 'password')
  assert.equal(control(ui.tree, '密码').props.type, 'password')
  assert.equal(control(ui.tree, '密码').props.required, true)
  assert.equal(elements(ui.tree).some((node) => node.props?.placeholder === '~/.ssh/id_ed25519'), false)
  await ui.change('认证方式', 'agent')
  assert.equal(elements(ui.tree).some((node) => node.props?.type === 'password'), false)
  assert.ok(elements(ui.tree).some((node) => node.type === 'summary' && node.children.includes('更多选项')))
})

test('copy inherits credentials and never submits editable authentication fields', async (t) => {
  const ui = await page(t, [savedHost])
  await ui.click('复制')
  assert.equal(elements(ui.tree).some((node) => node.type === 'select'), false)
  assert.equal(elements(ui.tree).some((node) => node.props?.type === 'password'), false)
  assert.ok(elements(ui.tree).some((node) => node.children.includes('继承源主机的认证信息、远端 Shell 和备注，无需重新输入。')))
  assert.equal(control(ui.tree, '主机标识 *').props.disabled, false)
  await ui.change('主机标识 *', 'lab-copy')
  await ui.submit()
  assert.deepEqual(ui.calls[1], { method: 'POST', path: '/hosts/lab%2Fa%20b/copy', body: {
    id: 'lab-copy', host: 'example.test', name: 'Lab 副本', port: 22, user: 'root',
  } })
})

test('editing clears notes and omits a blank password to preserve saved credentials', async (t) => {
  const ui = await page(t, [savedHost])
  await ui.click('编辑')
  assert.equal(control(ui.tree, '主机标识 *').props.disabled, true)
  assert.equal(control(ui.tree, '密码（留空保留原密码）').props.required, false)
  assert.equal(control(ui.tree, '密码（留空保留原密码）').props.value, '')
  await ui.change('备注', '')
  await ui.submit()
  assert.deepEqual(ui.calls[1], { method: 'POST', path: '/hosts/lab%2Fa%20b', body: {
    id: 'lab/a b', host: 'example.test', name: 'Lab', port: 22, user: 'root',
    authType: 'password', shell: 'ash', note: '',
  } })
  assert.equal('password' in ui.calls[1].body, false)
})

test('command and transfer tools keep their fields separate and submit the selected operation', async (t) => {
  const ui = await page(t, [savedHost])
  await ui.click('连接工具')
  await ui.change('目标主机', savedHost.id)
  await ui.change('远程命令', 'echo connected')
  await ui.submit()
  assert.deepEqual(ui.calls.at(-1), { method: 'POST', path: '/bash', body: {
    host: savedHost.id, command: 'echo connected', timeoutMs: 60000,
  } })
  await ui.click('传输文件')
  assert.equal(elements(ui.tree).some((node) => node.type === 'textarea'), false)
  assert.equal(button(ui.tree, '上传文件').props.disabled, true)
  await ui.change('本地路径', '/tmp/config')
  await ui.change('远端路径', '/etc/config')
  assert.equal(button(ui.tree, '上传文件').props.disabled, false)
  await ui.submit()
  assert.deepEqual(ui.calls.at(-1), { method: 'POST', path: '/upload', body: {
    host: savedHost.id, localPath: '/tmp/config', remotePath: '/etc/config',
  } })
  await ui.change('传输方向', 'download')
  await ui.submit()
  assert.equal(ui.calls.at(-1).path, '/download')
  await ui.click('执行命令')
  assert.equal(control(ui.tree, '远程命令').props.value, 'echo connected')
  assert.equal(elements(ui.tree).some((node) => node.props?.placeholder === '/tmp/file'), false)
})

test('settings show RPC error details and retry loading successfully', async (t) => {
  const browser = browserFixture()
  let attempts = 0
  const mounted = mount(browser, async () => ++attempts === 1
    ? { ok: false, error: { message: 'owner access required' } }
    : { ok: true, value: [] })
  t.after(() => mounted.dispose())
  const section = mounted.section()
  await browser.render(section)
  const tree = await browser.render(section)
  assert.ok(elements(tree).some((node) => node.props?.role === 'alert'))
  assert.ok(elements(tree).some((node) => node.type === 'summary' && node.children.includes('查看错误详情')))
  assert.ok(elements(tree).some((node) => node.props?.className === 'ssh-error'
    && node.children.includes('owner access required')))
  await button(tree, '重试').props.onClick()
  const recovered = await browser.render(section)
  assert.equal(attempts, 2)
  assert.equal(elements(recovered).some((node) => node.props?.role === 'alert'), false)
  assert.ok(elements(recovered).some((node) => node.children.includes('暂无主机，点击「添加主机」创建。')))
})

test('missing backend route explains the required full application restart', async (t) => {
  const browser = browserFixture()
  const mounted = mount(browser, async () => { throw new Error('transport failure for /api/dsh-ssh/request: HTTP 404') })
  t.after(() => mounted.dispose())
  const section = mounted.section()
  await browser.render(section)
  const tree = await browser.render(section)
  assert.ok(elements(tree).some((node) => node.children.some((child) =>
    typeof child === 'string' && child.includes('请完全退出 DeepSeek Harness 后重新打开'))))
  assert.ok(elements(tree).some((node) => node.children.includes('transport failure for /api/dsh-ssh/request: HTTP 404')))
})

const runtimeRoot = process.env.DSH_RUNTIME_DIR
let runtime
if (runtimeRoot) {
  const scoped = runtimeRoot.endsWith('@deepseek-ai') ? runtimeRoot : join(runtimeRoot, '@deepseek-ai')
  runtime = await import(pathToFileURL(resolve(scoped, 'cordis/lib/index.js')))
}

test('Desktop Cordis owns browser settings registration and style lifetimes', {
  skip: runtime ? false : 'Set DSH_RUNTIME_DIR to a Harness node_modules directory',
}, async (t) => {
  const browser = browserFixture()
  const root = new runtime.Context()
  t.after(() => root.fiber.dispose())
  const sections = new Map()
  class Slots extends runtime.Service {
    constructor(ctx) { super(ctx, 'slots') }
    inject(name, setup) {
      assert.equal(name, 'settings.section')
      return this.ctx.effect(setup)
    }
    register(options, render) {
      assert.equal(sections.has(options.id), false)
      sections.set(options.id, render)
      return () => sections.delete(options.id)
    }
  }
  root.provide('connection', { rpc: { call: async () => ({ ok: true, value: [] }) } })
  await root.plugin(Slots)
  const first = await root.plugin(browser.plugin)
  assert.equal(sections.size, 1)
  assert.equal(browser.styles.size, 1)
  await first.dispose()
  assert.equal(sections.size, 0)
  assert.equal(browser.styles.size, 0)
  const second = await root.plugin(browser.plugin)
  assert.equal(sections.size, 1)
  assert.equal(browser.styles.size, 1)
  await second.dispose()
  assert.equal(sections.size, 0)
  assert.equal(browser.styles.size, 0)
})
