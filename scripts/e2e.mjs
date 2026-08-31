import { runAcceptance } from './e2e/acceptance-flow.mjs'
import { safeError, safeLog } from './e2e/harness.mjs'

try {
  await runAcceptance('deterministic')
} catch (error) {
  safeLog({ ok: false, mode: 'deterministic', error: safeError(error) })
  process.exitCode = 1
}
