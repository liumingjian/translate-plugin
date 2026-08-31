import { runAcceptance } from './e2e/acceptance-flow.mjs'
import { loadRealServiceEnv, safeError, safeLog } from './e2e/harness.mjs'

let service = { apiKey: '' }

try {
  service = loadRealServiceEnv()
  await runAcceptance('real')
} catch (error) {
  safeLog({ ok: false, mode: 'real', error: safeError(error, [service.apiKey]) })
  process.exitCode = 1
}
