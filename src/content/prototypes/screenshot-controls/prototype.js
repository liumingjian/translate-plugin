const variants = [
  { key: 'A', name: '外沿双圆' },
  { key: 'B', name: '居中玻璃胶囊' },
  { key: 'C', name: '释放点垂直控件' },
]

const searchParams = new URLSearchParams(location.search)
const demoMode = searchParams.get('demo') === '1'

const prototype = document.querySelector('#prototype')
const surface = document.querySelector('#surface')
const selection = document.querySelector('#selection')
const controls = document.querySelector('#controls')
const variantLabel = document.querySelector('#variantLabel')

let variantIndex = Math.max(
  0,
  variants.findIndex(({ key }) => key === searchParams.get('variant')),
)
let rect = demoMode ? demoRect() : null
let interaction = null
let releasePoint = rect
  ? { x: rect.x + rect.width, y: rect.y + rect.height }
  : { x: innerWidth / 2, y: innerHeight / 2 }
let mode = demoMode ? 'selected' : 'waiting'

setVariant(variantIndex)
render()

surface.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || mode === 'confirmed' || mode === 'cancelled') return
  if (event.target.closest('.control-cluster')) return

  event.preventDefault()
  const point = getPoint(event)
  const handle = event.target.dataset.handle
  const moving = rect && event.target.closest('.selection') && !handle
  interaction = {
    type: handle ? 'resize' : moving ? 'move' : 'create',
    handle,
    start: point,
    initial: rect ? { ...rect } : null,
  }
  if (!moving && !handle) rect = { x: point.x, y: point.y, width: 0, height: 0 }
  mode = 'adjusting'
  surface.setPointerCapture(event.pointerId)
  render()
})

surface.addEventListener('pointermove', (event) => {
  if (!interaction || !surface.hasPointerCapture(event.pointerId)) return
  const point = getPoint(event)
  if (interaction.type === 'create') rect = createRect(interaction.start, point)
  if (interaction.type === 'move') rect = moveRect(interaction.initial, interaction.start, point)
  if (interaction.type === 'resize') {
    rect = resizeRect(interaction.initial, interaction.handle, point)
  }
  releasePoint = point
  render()
})

surface.addEventListener('pointerup', finishInteraction)
surface.addEventListener('pointercancel', finishInteraction)

document.querySelector('#cancel').addEventListener('click', (event) => {
  event.stopPropagation()
  mode = 'cancelled'
  render()
})

document.querySelector('#confirm').addEventListener('click', (event) => {
  event.stopPropagation()
  if (!validRect()) return
  mode = 'confirmed'
  render()
})

document.querySelector('#previousVariant').addEventListener('click', () => setVariant(variantIndex - 1))
document.querySelector('#nextVariant').addEventListener('click', () => setVariant(variantIndex + 1))

addEventListener('resize', () => {
  if (!rect) return
  rect = clampRect(rect)
  render()
})

addEventListener('keydown', (event) => {
  const target = event.composedPath()[0]
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    rect = { x: 26, y: 26, width: innerWidth - 52, height: innerHeight - 52 }
    releasePoint = { x: rect.x + rect.width, y: rect.y + rect.height }
    mode = 'selected'
    selection.focus({ preventScroll: true })
    render()
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    mode = 'cancelled'
    render()
    return
  }

  if (event.key === 'Enter' && validRect()) {
    event.preventDefault()
    mode = 'confirmed'
    render()
    return
  }

  if (event.target === selection && event.key.startsWith('Arrow') && rect) {
    event.preventDefault()
    const distance = event.shiftKey ? 10 : 1
    if (event.key === 'ArrowLeft') rect.x -= distance
    if (event.key === 'ArrowRight') rect.x += distance
    if (event.key === 'ArrowUp') rect.y -= distance
    if (event.key === 'ArrowDown') rect.y += distance
    rect = clampRect(rect)
    releasePoint = { x: rect.x + rect.width, y: rect.y + rect.height }
    mode = 'selected'
    render()
    return
  }

  if (event.key === 'ArrowLeft') setVariant(variantIndex - 1)
  if (event.key === 'ArrowRight') setVariant(variantIndex + 1)
})

function finishInteraction(event) {
  if (!interaction) return
  if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId)
  interaction = null
  mode = validRect() ? 'selected' : 'waiting'
  if (validRect()) selection.focus({ preventScroll: true })
  render()
}

function setVariant(index) {
  variantIndex = (index + variants.length) % variants.length
  const variant = variants[variantIndex]
  prototype.dataset.variant = variant.key
  variantLabel.textContent = `${variant.key} ${variant.name}`
  const url = new URL(location.href)
  url.searchParams.set('variant', variant.key)
  history.replaceState(null, '', url)
  requestAnimationFrame(placeControls)
}

function render() {
  prototype.dataset.mode = mode
  const hasRect = !!rect
  const valid = validRect()
  const controlsVisible = mode === 'selected' && valid
  selection.classList.toggle('visible', hasRect)
  selection.classList.toggle('invalid', hasRect && !valid)
  controls.classList.toggle('visible', controlsVisible)
  controls.setAttribute('aria-hidden', String(!controlsVisible))

  if (rect) {
    selection.style.left = `${rect.x}px`
    selection.style.top = `${rect.y}px`
    selection.style.width = `${rect.width}px`
    selection.style.height = `${rect.height}px`
    selection.setAttribute('aria-label', `${Math.round(rect.width)} x ${Math.round(rect.height)} 的框选区域`)
  }

  requestAnimationFrame(placeControls)
}

function placeControls() {
  if (!rect || !controls.classList.contains('visible')) return
  const width = controls.offsetWidth
  const height = controls.offsetHeight
  const gap = 12
  const availableBottom = innerHeight - 78
  let x
  let y

  if (variants[variantIndex].key === 'A') {
    x = rect.x + rect.width - width
    y = rect.y + rect.height + gap
    if (y + height > availableBottom) y = rect.y - height - gap
  } else if (variants[variantIndex].key === 'B') {
    x = rect.x + rect.width / 2 - width / 2
    y = rect.y + rect.height + gap
    if (y + height > availableBottom) y = rect.y - height - gap
  } else {
    const handleClearance = 32
    x = releasePoint.x + handleClearance
    y = releasePoint.y - height / 2
    if (x + width > innerWidth - gap) x = releasePoint.x - width - handleClearance
  }

  controls.style.left = `${clamp(x, gap, innerWidth - width - gap)}px`
  controls.style.top = `${clamp(y, gap, availableBottom - height)}px`
}

function validRect() {
  return !!rect && rect.width >= 16 && rect.height >= 16
}

function getPoint(event) {
  return { x: event.clientX, y: event.clientY }
}

function createRect(start, point) {
  return {
    x: Math.min(start.x, point.x),
    y: Math.min(start.y, point.y),
    width: Math.abs(point.x - start.x),
    height: Math.abs(point.y - start.y),
  }
}

function moveRect(initial, start, point) {
  return clampRect({
    ...initial,
    x: initial.x + point.x - start.x,
    y: initial.y + point.y - start.y,
  })
}

function resizeRect(initial, handle, point) {
  let left = initial.x
  let top = initial.y
  let right = initial.x + initial.width
  let bottom = initial.y + initial.height
  if (handle.includes('w')) left = point.x
  if (handle.includes('e')) right = point.x
  if (handle.includes('n')) top = point.y
  if (handle.includes('s')) bottom = point.y
  return clampRect({
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    width: Math.abs(right - left),
    height: Math.abs(bottom - top),
  })
}

function clampRect(value) {
  const width = Math.min(value.width, innerWidth)
  const height = Math.min(value.height, innerHeight)
  return {
    x: clamp(value.x, 0, innerWidth - width),
    y: clamp(value.y, 0, innerHeight - height),
    width,
    height,
  }
}

function demoRect() {
  const width = Math.min(860, innerWidth * 0.68)
  const height = Math.min(420, innerHeight * 0.48)
  return {
    x: (innerWidth - width) / 2,
    y: Math.max(92, (innerHeight - height) / 2 - 18),
    width,
    height,
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}
