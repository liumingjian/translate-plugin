import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(
  new URL('../src/content/prototypes/screenshot-controls/', import.meta.url),
).replace(/[\\/]$/, '')
const port = Number(process.env.TP_PROTOTYPE_PORT || 4178)
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
}

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname)
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1)
  const file = path.resolve(root, relative)
  if (!file.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end()
    return
  }

  try {
    await stat(file)
    response.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    createReadStream(file).pipe(response)
  } catch {
    response.writeHead(404).end('Not found')
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Screenshot controls prototype: http://127.0.0.1:${port}/?variant=A`)
})
