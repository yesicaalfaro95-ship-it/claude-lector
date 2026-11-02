import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { LectorStatus } from '../types'
import { markLine, seekTarget, toSentences, toSpoken } from './sentences'

const PANE = 'lector'
// La voz en español de Windows; si no está instalada, el script usa la normal.
const VOICE = 'Microsoft Sabina Desktop'
const MIN_RATE = -10
const MAX_RATE = 10

const IDLE: LectorStatus = {
  phase: 'idle',
  index: 0,
  total: 0,
  rate: 0,
  preview: '',
  note: '',
}
// Cambia la etiqueta si cambian los campos: lo que guardó una versión anterior
// se descarta, porque el valor sobrevive a una recarga.
const status = atom({ plugin: 'lector', key: 'status' } as const, IDLE, {
  shape: 'status-1',
})

// Esto vive en el módulo y se reinicia al recargar, igual que el proceso que
// habla (se cierra junto con el módulo).
let sentences: string[] = []
let cmdPath = ''
let seq = 0
let run = 0

const patch = ($: Engine, fields: Partial<LectorStatus>) =>
  update($, status, s => ({ ...s, ...fields }))

// Una orden para la voz: el script la lee de un archivo cada fracción de segundo.
const send = async ($: Engine, verb: string, arg?: number): Promise<boolean> => {
  if (cmdPath === '') return false
  seq += 1
  const line = `${seq} ${verb}${arg === undefined ? '' : ` ${arg}`}`

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await $.fs.write(cmdPath, line)
      return true
    } catch {
      await $.clock.sleep(60)
    }
  }
  return false
}

// El JSON sale solo con ASCII para que no dependa de la codificación del tubo.
const asAscii = (json: string): string =>
  json.replace(
    /[\u0080-￿]/g,
    c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )

const start = async ($: Engine, markdown: string): Promise<string> => {
  const parts = toSentences(markdown)
  if (parts.length === 0) return 'No hay texto para leer en esa respuesta.'

  await send($, 'stop')
  cmdPath = ''
  sentences = parts
  run += 1
  const mine = run

  const { rate } = await read($, status)
  await patch($, {
    phase: 'playing',
    index: 0,
    total: parts.length,
    preview: parts[0] ?? '',
    note: '',
  })

  const argv = [
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle',
    'Hidden',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    `${$.plugin.root}/hooks/speak.ps1`,
  ]
  const input = asAscii(JSON.stringify({ sentences: parts, start: 0, rate, voice: VOICE }))

  // La lectura sigue después de que este gancho termina: el proceso vive con el módulo.
  void (async () => {
    let buffer = ''
    let errors = ''
    let isEnded = false

    const onLine = async (line: string) => {
      if (line.startsWith('READY ')) {
        cmdPath = line.slice(6).trim()
      } else if (line.startsWith('S ')) {
        const n = Number(line.slice(2))
        await patch($, { index: n, preview: sentences[n] ?? '' })
      } else if (line === 'END') {
        isEnded = true
        await update($, status, s =>
          s.phase === 'idle' ? s : { ...s, phase: 'idle', note: 'Terminó la lectura.' },
        )
      } else if (line.startsWith('ERR ')) {
        errors += line.slice(4)
      }
    }

    try {
      for await (const { stream, text } of $.process.spawn({ argv, input })) {
        if (mine !== run) continue
        if (stream === 'stderr') {
          errors += text
          continue
        }
        buffer += text
        for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (line !== '') await onLine(line)
        }
      }
    } catch (error) {
      errors += String(error)
    }

    if (mine !== run) return
    cmdPath = ''
    if (!isEnded) {
      const why = errors.trim() === '' ? 'La lectura se detuvo.' : `No se pudo leer: ${errors.trim().slice(0, 160)}`
      await patch($, { phase: 'idle', note: why })
    }
  })()

  return `Leyendo ${parts.length} frases.`
}

const pause = async ($: Engine) => {
  if (await send($, 'pause')) await patch($, { phase: 'paused' })
}

const resume = async ($: Engine) => {
  if (await send($, 'resume')) await patch($, { phase: 'playing' })
}

// Mueve la lectura unos 10 s: salta las frases que caben en ese tiempo.
const seek = async ($: Engine, dir: -1 | 1) => {
  const s = await read($, status)
  if (s.phase === 'idle') return
  const lengths = sentences.map(sentence => sentence.length)
  await send($, 'goto', seekTarget(lengths, s.index, dir, s.rate))
}

const stop = async ($: Engine) => {
  await send($, 'stop')
  await patch($, { phase: 'idle', note: 'Detenido.' })
}

const changeRate = async ($: Engine, delta: number) => {
  const s = await read($, status)
  const rate = Math.max(MIN_RATE, Math.min(MAX_RATE, s.rate + delta))
  await patch($, { rate })
  if (s.phase !== 'idle') await send($, 'rate', rate)
}

// La n-ésima respuesta de Claude contando desde la última (1 es la última).
const answer = async ($: Engine, n: number): Promise<string | undefined> => {
  const found = await $.session.messages()
  if ('deny' in found) return undefined
  const answers = found.filter(m => m.role === 'assistant' && m.text.trim() !== '')
  return answers[answers.length - n]?.text
}

const openPane = ($: Engine) => $.ui.open({ id: PANE, title: 'Lector' })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'leer',
      description: 'Lee en voz alta la última respuesta, con panel de pausa y saltos de 10 s',
      argumentHint: '[pausa | seguir | atras | adelante | parar | panel | n]',
    })
    // Una recarga cerró la voz: lo que quedó guardado ya no suena.
    await update($, status, s => ({ ...IDLE, rate: s.rate }))

    return next(e)
  })

  on('command.run', { command: 'leer' }, async ($, e) => {
    const typed = (e.args ?? '').trim()

    switch (typed.toLowerCase()) {
      case 'pausa':
        await pause($)
        return { text: 'Lectura en pausa.' }
      case 'seguir':
        await resume($)
        return { text: 'Sigo leyendo.' }
      case 'atras':
      case 'atrás':
        await seek($, -1)
        return { text: 'Atrasé unos 10 segundos.' }
      case 'adelante':
        await seek($, 1)
        return { text: 'Adelanté unos 10 segundos.' }
      case 'parar':
        await stop($)
        return { text: 'Lectura detenida.' }
      case 'panel':
        await openPane($)
        return { text: 'Panel del lector abierto.' }
    }

    const asked = Number(typed)
    const n = Number.isInteger(asked) && asked > 0 ? asked : 1
    const text = await answer($, n)
    if (text === undefined) return { text: 'No encontré una respuesta para leer.' }

    const opened = await openPane($)
    const said = await start($, text)

    return {
      text: opened.isPlaced
        ? said
        : `${said} El panel no se pudo mostrar (${opened.reason}); usa /leer pausa, seguir, atras, adelante y parar.`,
    }
  })

  // En el mensaje del chat, un ▶ marca la frase que suena. Solo cambia lo que se
  // dibuja: el mensaje guardado queda igual.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const s = await read($, status)
    const current = sentences[s.index]
    if (s.phase === 'idle' || current === undefined || e.props.isSummary) return next(e)

    const found = toSpoken(e.props.text).find(spoken => spoken.text === current)
    if (found === undefined) return next(e)

    const lines = e.props.text.split('\n')
    lines[found.line] = markLine(lines[found.line] ?? '', current)

    return next({ ...e, props: { ...e.props, text: lines.join('\n') } })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await read($, status)

    const isActive = s.phase !== 'idle'
    const pct = s.total > 0 ? Math.round(((s.index + 1) / s.total) * 100) : 0
    const filled = Math.round(pct / 5)
    const bar = `${'█'.repeat(filled)}${'░'.repeat(20 - filled)} ${pct} %`
    const where = `frase ${s.index + 1} de ${s.total}`
    const headline =
      s.phase === 'playing' ? `Leyendo · ${where}` : s.phase === 'paused' ? `En pausa · ${where}` : 'Sin lectura'
    const speed = s.rate === 0 ? 'normal' : s.rate > 0 ? `+${s.rate}` : `${s.rate}`

    const readLast = async () => {
      const text = await answer($, 1)
      if (text === undefined) await patch($, { note: 'No encontré una respuesta para leer.' })
      else await start($, text)
    }

    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text bold>Lector en voz alta</Text>
        <Text>{headline}</Text>
        {isActive && <Text dimColor>{bar}</Text>}
        {isActive && s.preview !== '' && <Text wrap="wrap">{s.preview}</Text>}
        {s.note !== '' && <Text dimColor>{s.note}</Text>}
        {isActive ? (
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Button key="back" onPress={() => void seek($, -1)}>
              ⏪ 10 s
            </Button>
            <Button
              key="toggle"
              variant="primary"
              onPress={() => void (s.phase === 'paused' ? resume($) : pause($))}
            >
              {s.phase === 'paused' ? '▶ Seguir' : '⏸ Pausa'}
            </Button>
            <Button key="forward" onPress={() => void seek($, 1)}>
              10 s ⏩
            </Button>
            <Button key="stop" onPress={() => void stop($)}>
              ⏹ Parar
            </Button>
          </Box>
        ) : (
          <Button key="read" variant="primary" onPress={() => void readLast()}>
            Leer la última respuesta
          </Button>
        )}
        <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
          <Button key="slower" onPress={() => void changeRate($, -1)}>
            Más lento
          </Button>
          <Text>Velocidad: {speed}</Text>
          <Button key="faster" onPress={() => void changeRate($, 1)}>
            Más rápido
          </Button>
        </Box>
      </Box>
    )
  })
}
