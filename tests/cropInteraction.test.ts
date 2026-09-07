import { describe, expect, it, vi } from 'vitest'
import { CropInteractionController } from '../src/shared/cropInteraction'

describe('CropInteractionController', () => {
  it('shares create, move, resize and keyboard transitions within bounds', () => {
    const changed = vi.fn()
    const controller = new CropInteractionController(changed)
    controller.setBounds({ width: 200, height: 100 })
    controller.begin({ x: 20, y: 10 }, 'create')
    controller.update({ x: 100, y: 60 })
    controller.end()
    expect(controller.getRect()).toEqual({ x: 20, y: 10, width: 80, height: 50 })

    controller.begin({ x: 40, y: 30 }, 'move')
    controller.update({ x: 190, y: 90 })
    controller.end()
    expect(controller.getRect()).toEqual({ x: 120, y: 50, width: 80, height: 50 })

    controller.begin({ x: 120, y: 50 }, 'nw')
    controller.update({ x: 100, y: 30 })
    controller.end()
    controller.adjust('ArrowLeft', 10)
    expect(controller.getRect()).toEqual({ x: 90, y: 30, width: 100, height: 70 })
    expect(changed).toHaveBeenCalled()
  })

  it('scales an existing selection when rendered bounds change', () => {
    const controller = new CropInteractionController()
    controller.setBounds({ width: 400, height: 200 })
    controller.setRect({ x: 100, y: 50, width: 200, height: 100 })
    controller.setBounds({ width: 200, height: 100 }, true)
    expect(controller.getRect()).toEqual({ x: 50, y: 25, width: 100, height: 50 })
  })
})
