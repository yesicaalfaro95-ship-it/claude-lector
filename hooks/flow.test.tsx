import { expect, test } from 'claude-code/testing'

// Deja correr lo que el módulo dejó sin esperar (la lectura sigue después del comando).
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 30))

const MESSAGE =
  '## Título\n\nPrimera frase de la respuesta que se lee. Segunda frase de la respuesta que se lee.'

test('/leer lee la última respuesta, marca el chat y las órdenes llegan al script de voz', async ($, on) => {
  const orders: string[] = []
  let spawned: { argv: readonly string[]; input?: string } | undefined
  let release = () => {}
  const ended = new Promise<void>(resolve => {
    release = resolve
  })

  on('command.register', () => ({ value: { command: 'leer' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'lee esto', toolUses: [] },
      { role: 'assistant', text: MESSAGE, toolUses: [] },
    ],
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.write', (_, e) => {
    orders.push(`${e.path}|${e.text}`)
    if (e.text.endsWith(' stop')) release()
    return { value: undefined }
  })
  // La voz simulada: avisa que está lista, empieza la frase 0 y vive hasta que le piden parar.
  on('process.spawn', async function* (_, e) {
    spawned = { argv: e.argv, input: e.input }
    yield { stream: 'stdout' as const, text: 'READY C:\\tmp\\cmd.txt\nS 0\n' }
    await ended
    yield { stream: 'stdout' as const, text: 'END\n' }
    return { value: { code: 0, signal: null } }
  })
  // El chat sin el mod dibuja el texto tal cual: aquí se ve lo que el mod le pasa.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{String((e.props as { text?: string }).text)}</Text>
  })

  const drawMessage = async () => {
    const ui = await $.ui.mount({
      plugin: 'lector',
      component: 'AssistantMessage',
      requestId: 'm1',
      surface: 'desktop',
      props: { text: MESSAGE, isFirstOfReply: true },
    })
    const drawn = (await ui.find({ type: 'Text' }))?.text ?? ''
    await ui.unmount()
    return drawn
  }

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const started = await $.command.run({ command: 'leer' })
  expect(started.text).toContain('Leyendo')
  await settle()

  expect(spawned?.argv.some(part => part.endsWith('speak.ps1'))).toBe(true)
  expect(spawned?.input).toContain('Primera frase de la respuesta que se lee.')
  // Los acentos viajan escapados (`T\u00edtulo`), solo ASCII, y sin los `##`.
  expect(spawned?.input).toContain('T\\u00edtulo')
  expect(spawned?.input?.includes('##')).toBe(false)

  // La frase 0 suena: el chat la marca con ▶, sin tocar lo demás del mensaje.
  expect(await drawMessage()).toBe(
    '## ▶ Título\n\nPrimera frase de la respuesta que se lee. Segunda frase de la respuesta que se lee.',
  )

  await $.command.run({ command: 'leer', args: 'pausa' })
  await $.command.run({ command: 'leer', args: 'adelante' })
  await $.command.run({ command: 'leer', args: 'parar' })
  await settle()

  expect(orders).toEqual([
    'C:\\tmp\\cmd.txt|1 pause',
    // Adelantar 10 s desde la frase 0 pasa del final: la lectura termina.
    'C:\\tmp\\cmd.txt|2 goto 2',
    'C:\\tmp\\cmd.txt|3 stop',
  ])

  // Sin lectura, el mensaje se dibuja como estaba.
  expect(await drawMessage()).toBe(MESSAGE)
})
