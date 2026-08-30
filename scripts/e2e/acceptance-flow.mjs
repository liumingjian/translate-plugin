import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  FIXTURES,
  closeServer,
  createFixtureServer,
  launchExtension,
  listen,
  loadRealServiceEnv,
  safeLog,
  sendSse,
  setSettings,
} from './harness.mjs'

const fixtureText = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'acceptance-text.json'), 'utf8'))
const fixtureImage = Buffer.from(
  fs.readFileSync(path.join(FIXTURES, 'acceptance-image.webp.base64'), 'utf8').trim(),
  'base64',
)
const LONG_TEXT = 'fixed public acceptance text '.repeat(200)

export async function runAcceptance(mode) {
  assert.equal(
    createHash('sha256').update(fixtureImage).digest('hex'),
    '404d78fc3680dd8bdc60e371f982cbe1386977dd35c00c028828123e8741ff73',
    'committed image fixture integrity check failed',
  )
  const requests = []
  const server = createFixtureServer({
    pageHtml: fixturePage(fixtureText),
    onChat(body, response) {
      requests.push(requestBoundary(body))
      const userContent = body.messages.at(-1)?.content
      if (Array.isArray(userContent)) {
        sendSse(response, 'EN>ZH\n固定图片译文。')
        return
      }
      const translation =
        userContent === fixtureText.chinese
          ? fixtureText.chineseTranslation
          : userContent === fixtureText.question
            ? fixtureText.questionTranslation
            : fixtureText.englishTranslation
      sendSse(response, `EN>ZH\n${translation}`)
    },
  })
  const pageOrigin = await listen(server)
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'translate-plugin-acceptance-'))
  const imagePath = path.join(tempDirectory, 'acceptance-image.webp')
  fs.writeFileSync(imagePath, fixtureImage)

  let browser
  try {
    const service = mode === 'real' ? loadRealServiceEnv() : {
      baseUrl: pageOrigin,
      apiKey: 'deterministic-e2e-key',
    }
    if (mode === 'real' && (!service.baseUrl || !service.apiKey)) {
      safeLog({ ok: true, mode, skipped: 'credentials-unavailable' })
      return
    }

    const extension = await launchExtension()
    browser = extension.browser
    await setSettings(extension.worker, null)
    const page = await browser.newPage()
    await page.setViewport({ width: 1000, height: 720, deviceScaleFactor: 1 })
    await page.goto(pageOrigin, { waitUntil: 'load' })
    await installTextHelpers(page)

    safeLog({ mode, step: 'missing-key' })
    await openTextTranslation(page, 'english')
    const noKey = await waitForTextCard(page, 10_000)
    assert(noKey.error && noKey.result.includes('api-key'), 'missing-key state was not shown')

    await setSettings(extension.worker, {
      baseUrl: service.baseUrl,
      apiKey: service.apiKey,
      model: 'gpt-5.4-mini',
      imageModel: 'gpt-5.5',
      imagePrivacyAccepted: true,
      autoReadClipboard: false,
    })

    await page.reload({ waitUntil: 'load' })
    await installTextHelpers(page)
    safeLog({ mode, step: 'text-selection' })
    await openTextTranslation(page, 'english')
    const english = await waitForTextCard(page, mode === 'real' ? 120_000 : 10_000)
    assert(!english.error && english.result.length > 0, 'text fixture translation did not finish')

    if (mode === 'deterministic') {
      assert.equal(english.result, fixtureText.englishTranslation)
      safeLog({ mode, step: 'text-regressions' })
      await runTextRegressions(page, requests)
    }

    safeLog({ mode, step: 'image-import' })
    const workspace = await openWorkspace(browser, extension.worker, extension.extensionOrigin, page)
    const input = await workspace.$('#fileInput')
    assert(input, 'workspace file input was not available')
    await input.uploadFile(imagePath)
    await workspace.waitForFunction(() => document.querySelector('#sourceImage')?.naturalWidth > 0)
    await workspace.click('#translate')
    await workspace.waitForFunction(
      () =>
        !document.querySelector('#copy')?.disabled ||
        !document.querySelector('#resultError')?.classList.contains('hidden'),
      { timeout: mode === 'real' ? 120_000 : 10_000 },
    )
    const imageState = await workspace.evaluate(() => ({
      resultLength: document.querySelector('#result')?.textContent?.trim().length ?? 0,
      error: !document.querySelector('#resultError')?.classList.contains('hidden'),
    }))
    assert(!imageState.error && imageState.resultLength > 0, 'image fixture translation did not finish')

    if (mode === 'deterministic') {
      assert.deepEqual(requests.map(({ model, image }) => ({ model, image })), [
        { model: 'gpt-5.4-mini', image: false },
        { model: 'gpt-5.4-mini', image: false },
        { model: 'gpt-5.4-mini', image: false },
        { model: 'gpt-5.5', image: true },
      ])
      assert(requests.at(-1).imageBytes > 0, 'image request did not contain encoded pixels')
    }

    safeLog({
      ok: true,
      mode,
      workflows: ['missing-key', 'text-selection', 'image-import'],
      models: ['gpt-5.4-mini', 'gpt-5.5'],
      fixturesOnly: true,
      redactedOutput: true,
    })
  } finally {
    if (browser) await browser.close()
    await closeServer(server)
    fs.rmSync(tempDirectory, { recursive: true, force: true })
  }
}

async function runTextRegressions(page, requests) {
  await page.reload({ waitUntil: 'load' })
  await installTextHelpers(page)
  await openTextTranslation(page, 'chinese')
  assert.equal((await waitForTextCard(page, 10_000)).result, fixtureText.chineseTranslation)

  await page.reload({ waitUntil: 'load' })
  await installTextHelpers(page)
  await openTextTranslation(page, 'question')
  assert.equal((await waitForTextCard(page, 10_000)).result, fixtureText.questionTranslation)
  const beforeCache = requests.length

  await page.reload({ waitUntil: 'load' })
  await installTextHelpers(page)
  await openTextTranslation(page, 'question')
  assert.equal((await waitForTextCard(page, 10_000)).result, fixtureText.questionTranslation)
  assert.equal(requests.length, beforeCache, 'cached text created another service request')

  await page.reload({ waitUntil: 'load' })
  await installTextHelpers(page)
  await openTextTranslation(page, 'long')
  const tooLong = await waitForTextCard(page, 10_000)
  assert(tooLong.error && tooLong.result.includes('选区超过'), 'long selection was not rejected')
  assert.equal(requests.length, beforeCache, 'long selection reached the service')

  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
  await page.reload({ waitUntil: 'load' })
  await installTextHelpers(page)
  await openTextTranslation(page, 'english')
  const dark = await waitForTextCard(page, 10_000)
  assert(!dark.error && dark.result.length > 0, 'dark-theme text translation did not finish')
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
}

function fixturePage(text) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Acceptance fixture</title>
<style>body{font:18px/1.6 sans-serif;max-width:760px;margin:40px auto;padding:20px}@media(prefers-color-scheme:dark){body{background:#111;color:#eee}}</style>
</head><body><p id="english">${escapeHtml(text.english)}</p><p id="chinese">${escapeHtml(text.chinese)}</p><p id="question">${escapeHtml(text.question)}</p><p id="long">${LONG_TEXT}</p></body></html>`
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function requestBoundary(body) {
  const content = body.messages.at(-1)?.content
  const imageUrl = Array.isArray(content)
    ? content.find((item) => item.type === 'image_url')?.image_url?.url ?? ''
    : ''
  return {
    model: body.model,
    image: imageUrl !== '',
    imageBytes: imageUrl === '' ? 0 : Buffer.byteLength(imageUrl.split(',')[1] ?? '', 'base64'),
  }
}

async function installTextHelpers(page) {
  await page.evaluate(() => {
    window.__textCard = () => {
      for (const host of document.documentElement.children) {
        const card = host.shadowRoot?.querySelector('.card')
        if (!card || card.classList.contains('hidden')) continue
        const error = !!card.querySelector('.result .error')
        return {
          result: card.querySelector('.result')?.textContent?.trim() ?? '',
          error,
          settled: error || [...card.querySelectorAll('.action')].some(
            (button) => !button.classList.contains('hidden'),
          ),
        }
      }
      return null
    }
  })
}

async function openTextTranslation(page, id) {
  const deadline = Date.now() + 10_000
  for (;;) {
    const icon = await page.evaluate((elementId) => {
      const element = document.getElementById(elementId)
      const range = document.createRange()
      range.selectNodeContents(element)
      const selection = getSelection()
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      for (const host of document.documentElement.children) {
        const candidate = host.shadowRoot?.querySelector('.icon')
        if (!candidate || candidate.classList.contains('hidden')) continue
        const rect = candidate.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      }
      return null
    }, id)
    if (icon) {
      await page.mouse.click(icon.x, icon.y)
      return
    }
    if (Date.now() >= deadline) throw new Error('text selection icon did not appear')
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

async function waitForTextCard(page, timeout) {
  await page.waitForFunction(() => window.__textCard()?.settled, { timeout })
  return page.evaluate(() => window.__textCard())
}

async function openWorkspace(browser, worker, extensionOrigin, activePage) {
  await activePage.bringToFront()
  const existingPopupTargets = new Set(browser.targets())
  await worker.evaluate(async () => chrome.action.openPopup())
  const popupTarget = await browser.waitForTarget(
    (candidate) =>
      !existingPopupTargets.has(candidate) &&
      candidate.url() === `${extensionOrigin}/src/popup/index.html`,
    { timeout: 10_000 },
  )
  const popup = await popupTarget.asPage()
  await popup.waitForSelector('#import')
  const existingWorkspaceTargets = new Set(browser.targets())
  await popup.click('#import')
  const workspaceTarget = await browser.waitForTarget(
    (candidate) =>
      !existingWorkspaceTargets.has(candidate) &&
      candidate.url().startsWith(`${extensionOrigin}/src/workspace/index.html`),
    { timeout: 10_000 },
  )
  const workspace = await workspaceTarget.page()
  if (!workspace) throw new Error('image workspace did not open')
  await workspace.waitForSelector('#fileInput')
  return workspace
}
