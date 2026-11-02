import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'lector',
  component: 'Pane',
  requestId: 'lector',
  props: {
    title: 'Lector',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('sin lectura el panel ofrece leer la última respuesta, en cada superficie', async ($) => {
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /Sin lectura/ }))?.text).toBe('Sin lectura')
    expect(await ui.find({ type: 'Button', text: /Leer la última respuesta/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /Más rápido/ })).toBeDefined()
    await ui.unmount()
  }
})

test('con una lectura en curso el panel muestra los controles', async ($, on) => {
  // Lo guardado lleva la misma etiqueta que el módulo: así el panel lo lee como suyo.
  on('state.get', () => ({
    value: {
      value: {
        shape: 'status-1',
        value: {
          phase: 'playing',
          index: 2,
          total: 10,
          rate: 0,
          preview: 'Tercera frase.',
          note: '',
        },
      },
      version: 1,
    },
  }))

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /Leyendo · frase 3 de 10/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Pausa/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /10 s/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: /Parar/ })).toBeDefined()
  await ui.unmount()
})
