import { expect, test } from 'claude-code/testing'

import { markLine, seekTarget, toSentences, toSpoken } from './sentences'

test('el markdown se limpia y se parte en frases', async () => {
  const markdown = [
    '## Medidas',
    '',
    '- **Ancho** del espacio, en cm.',
    '1. Mide 27.9 × 21.6 cm.',
    '| App | Costo |',
    '|---|---|',
    '| Medida | Gratis |',
    '```ts',
    'const x = 1',
    '```',
    'Lee [esto](https://example.com/a). Luego sigue. 😀',
  ].join('\n')

  const spoken = toSentences(markdown).join(' ')

  expect(spoken).toContain('centímetros')
  expect(spoken).toContain('27.9 por 21.6')
  expect(spoken).toContain('Medida, Gratis')
  expect(spoken).toContain('Lee esto.')
  for (const gone of ['**', '|', '```', 'const x', 'https', '😀', '---', '##']) {
    expect(spoken.includes(gone)).toBe(false)
  }
})

test('las frases muy cortas se juntan y las muy largas se cortan en comas', async () => {
  const short = toSentences('Sí. No. Tal vez. Quizá más tarde sí.')
  expect(short).toHaveLength(1)

  const long = toSentences(Array(80).fill('una palabra').join(', ') + '.')
  expect(long.length > 1).toBe(true)
  for (const part of long) expect(part.length <= 262).toBe(true)
})

test('cada frase recuerda su línea del texto original, aunque haya bloques de código', async () => {
  const markdown = [
    'Primera línea que se lee completa.',
    '```',
    'codigo',
    'mas codigo',
    '```',
    '- Un punto de la lista que se lee.',
  ].join('\n')

  expect(toSpoken(markdown).map(s => s.line)).toEqual([0, 5])
})

test('la marca ▶ va junto a la frase o, si no se ve tal cual, al inicio de la línea', async () => {
  expect(markLine('Primera frase de prueba. Segunda frase de prueba.', 'Segunda frase de prueba.')).toBe(
    'Primera frase de prueba. ▶ Segunda frase de prueba.',
  )
  expect(markLine('- **Ancho** del espacio', 'Ancho del espacio')).toBe('- ▶ **Ancho** del espacio')
  expect(markLine('## Título', 'Título Primera frase')).toBe('## ▶ Título')
  expect(markLine('| a | b |', 'a, b')).toBe('| ▶ a | b |')
})

test('saltar unos 10 segundos suma las frases que caben en ese tiempo', async () => {
  const lengths = [100, 100, 100, 100, 100]

  // A velocidad normal son unos 150 caracteres.
  expect(seekTarget(lengths, 4, -1, 0)).toBe(2)
  expect(seekTarget(lengths, 1, 1, 0)).toBe(3)
  // Pasar del final devuelve el total: la lectura termina.
  expect(seekTarget(lengths, 3, 1, 0)).toBe(5)
  // Al inicio no hay a dónde atrasar.
  expect(seekTarget(lengths, 0, -1, 0)).toBe(0)
  // Con la voz más rápida caben más caracteres en 10 s.
  expect(seekTarget(lengths, 4, -1, 10)).toBe(0)
})
