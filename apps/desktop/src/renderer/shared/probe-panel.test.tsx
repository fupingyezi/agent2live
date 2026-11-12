import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProbePanel } from './probe-panel'

describe('ProbePanel', () => {
  it('renders the real Live2D probe object', () => {
    const probe = {
      parameterIds: ['ParamAngleX'],
      partIds: ['PartArmL'],
      drawableCount: 2,
      canvasWidth: 512,
      canvasHeight: 512,
      coreVersion: '5-test',
      motionGroups: { Idle: 1 },
      expressions: ['smile'],
      idleStarted: true
    }
    expect(renderToStaticMarkup(<ProbePanel probe={probe} />)).toContain('ParamAngleX')
  })
})
