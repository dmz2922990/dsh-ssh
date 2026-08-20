// dsh-ssh web API half (web profile only): mounts the JSON API under
// /dsh-ssh/api/* for the browser settings page. Declared as a hard inject on
// `webServer` and `ssh.hosts` so the Loader resolves both before applying —
// ctx.get() at apply time would see neither (services are visible only via
// declared injection ordering).

export const inject = ['webServer', 'ssh.hosts']

export function apply(ctx) {
  const ssh = ctx['ssh.hosts']
  const webServer = ctx.webServer

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data', (chunk) => { data += chunk })
      req.on('end', () => {
        try { resolve(data ? JSON.parse(data) : {}) } catch (e) { reject(e) }
      })
      req.on('error', reject)
    })
  }

  function send(res, status, value) {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(value))
  }

  async function bashOnHost(host, command, timeoutMs, shell) {
    return ssh.bash(host, command, timeoutMs, shell)
  }

  const api = async (req, res) => {
    const path = String(req.url || '').split('?')[0]
    const method = String(req.method || 'GET').toUpperCase()
    try {
      if (method === 'GET' && path === '/dsh-ssh/api/hosts') {
        return send(res, 200, await ssh.list())
      }
      if (method === 'POST' && path === '/dsh-ssh/api/hosts') {
        const body = await readBody(req)
        return send(res, 200, await ssh.add({
          id: body.id, name: body.name, host: body.host, port: body.port, user: body.user, note: body.note, shell: body.shell,
          auth: { type: body.authType, keyPath: body.keyPath, password: body.password },
        }))
      }
      if (method === 'POST' && path.startsWith('/dsh-ssh/api/hosts/')) {
        const id = decodeURIComponent(path.slice('/dsh-ssh/api/hosts/'.length))
        const body = await readBody(req)
        const patch = {}
        for (const key of ['host', 'name', 'port', 'user', 'note', 'shell']) {
          if (body[key] !== undefined) patch[key] = body[key]
        }
        if (body.authType !== undefined || body.keyPath !== undefined || body.password !== undefined) {
          patch.auth = { type: body.authType, keyPath: body.keyPath, password: body.password }
        }
        return send(res, 200, await ssh.update(id, patch))
      }
      if (method === 'POST' && path.startsWith('/dsh-ssh/api/hosts/') && path.endsWith('/copy')) {
        const id = decodeURIComponent(path.slice('/dsh-ssh/api/hosts/'.length, -'/copy'.length))
        const body = await readBody(req)
        return send(res, 200, await ssh.copy(id, { id: body.id, host: body.host, name: body.name, port: body.port, user: body.user }))
      }
      if (method === 'DELETE' && path.startsWith('/dsh-ssh/api/hosts/')) {
        const id = decodeURIComponent(path.slice('/dsh-ssh/api/hosts/'.length))
        return send(res, 200, { ok: await ssh.remove(id) })
      }
      if (method === 'POST' && path === '/dsh-ssh/api/bash') {
        const body = await readBody(req)
        return send(res, 200, await bashOnHost(body.host, body.command, body.timeoutMs || 60000, body.shell))
      }
      return send(res, 404, { error: 'not found: ' + method + ' ' + path })
    } catch (e) {
      return send(res, 400, { error: String(e && e.message || e) })
    }
  }

  ctx.effect(() => webServer.register({ kind: 'prefix', path: '/dsh-ssh/api', handler: api }), 'dsh-ssh web api')
  ctx.logger?.info?.('dsh-ssh: web api mounted at /dsh-ssh/api/*')
}
