// De una respuesta en markdown a frases cortas para leer en voz alta, y la
// cuenta de cuántas frases saltar para atrasar o adelantar unos 10 segundos.

// Lo que se lee en unos 10 s a velocidad normal (unos 15 caracteres por segundo).
const CHARS_PER_10S = 150
// Una frase más larga se corta en comas; una más corta se junta con la siguiente.
const MAX_LEN = 260
const MIN_LEN = 24

const SPOKEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/(^|[^A-Za-z])cm(?![A-Za-z])/g, '$1 centímetros'],
  [/(^|[^A-Za-z])mm(?![A-Za-z])/g, '$1 milímetros'],
  [/×/g, ' por '],
  [/±/g, ' más o menos '],
  [/[≈~]/g, ' aproximadamente '],
  [/[→⇒]/g, ', '],
]

const cleanLine = (raw: string): string => {
  // Separador de tabla o línea horizontal: no se lee.
  if (/^[ \t]*\|?[ \t:|-]*-[ \t:|-]*$/.test(raw)) return ''

  let line = raw
    .replace(/^[ \t]*#{1,6}[ \t]*/, '')
    .replace(/^[ \t]*>[ \t]?/, '')
    .replace(/^[ \t]*([-*+•]|\d+[.)])[ \t]+/, '')
    .replace(/^[ \t]*\|[ \t]*/, '')
    .replace(/[ \t]*\|[ \t]*$/, '')
    .replace(/[ \t]*\|[ \t]*/g, ', ')
    .replace(/(\*\*|__|~~)/g, '')
    .replace(/\*/g, '')

  for (const [pattern, spoken] of SPOKEN) line = line.replace(pattern, spoken)

  return line
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
    .replace(/[←-⇿⌀-⏿☀-➿️‍]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

const chunk = (sentence: string): string[] => {
  const out: string[] = []
  let rest = sentence

  while (rest.length > MAX_LEN) {
    const head = rest.slice(0, MAX_LEN)
    let cut = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '), head.lastIndexOf(': '))
    if (cut < 60) cut = head.lastIndexOf(' ')
    if (cut < 1) cut = MAX_LEN
    out.push(rest.slice(0, cut + 1).trim())
    rest = rest.slice(cut + 1).trim()
  }
  if (rest !== '') out.push(rest)

  return out
}

/** Una frase para leer y la línea del markdown donde empieza (desde 0). */
export type Spoken = { text: string; line: number }

export const toSpoken = (markdown: string): Spoken[] => {
  // Cada paso conserva los saltos de línea: `line` cuenta las del texto original.
  const text = markdown
    .replace(/```[\s\S]*?```/g, fence => '\n'.repeat(fence.split('\n').length - 1))
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, '')
    .replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/<[^>\n]+>/g, '')

  const pieces: Spoken[] = []
  text.split('\n').forEach((raw, line) => {
    const clean = cleanLine(raw)
    if (clean === '') return
    for (const sentence of clean.replace(/([.!?…]+)[ \t]+(?=\S)/g, '$1\n').split('\n')) {
      for (const part of chunk(sentence.trim())) pieces.push({ text: part, line })
    }
  })

  const merged: Spoken[] = []
  let pending: Spoken | undefined
  for (const piece of pieces) {
    const joined: Spoken =
      pending === undefined ? piece : { text: `${pending.text} ${piece.text}`, line: pending.line }
    if (joined.text.length < MIN_LEN) {
      pending = joined
      continue
    }
    merged.push(joined)
    pending = undefined
  }
  if (pending !== undefined) {
    const last = merged[merged.length - 1]
    if (last === undefined) merged.push(pending)
    else last.text += ` ${pending.text}`
  }

  return merged.filter(s => /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/.test(s.text))
}

export const toSentences = (markdown: string): string[] => toSpoken(markdown).map(s => s.text)

const MARK = '▶ '

/**
 * La línea del markdown con una marca ▶ donde empieza `sentence`: junto a su
 * primera palabra si esa se ve tal cual en la línea; si no, al inicio, después
 * del símbolo de título, lista, cita o tabla.
 */
export const markLine = (raw: string, sentence: string): string => {
  const key = sentence.slice(0, 16)
  const at = key.length >= 8 ? raw.indexOf(key) : -1
  if (at >= 0) return `${raw.slice(0, at)}${MARK}${raw.slice(at)}`

  const prefix = /^[ \t]*(#{1,6}[ \t]+|>[ \t]?|([-*+•]|\d+[.)])[ \t]+|\|[ \t]*)?/.exec(raw)?.[0] ?? ''
  return `${prefix}${MARK}${raw.slice(prefix.length)}`
}

/**
 * La frase a la que saltar para mover la lectura unos 10 s desde `current`.
 * `dir` -1 atrasa, 1 adelanta; `rate` es la velocidad de la voz (-10 a 10).
 * Adelantar puede devolver `lengths.length`: pasó el final.
 */
export const seekTarget = (
  lengths: readonly number[],
  current: number,
  dir: -1 | 1,
  rate: number,
): number => {
  const goal = Math.round(CHARS_PER_10S * Math.pow(3, rate / 10))
  let sum = 0
  let i = current

  if (dir === -1) {
    while (i > 0 && sum < goal) {
      i -= 1
      sum += lengths[i] ?? 0
    }
    return i
  }

  while (i < lengths.length && sum < goal) {
    sum += lengths[i] ?? 0
    i += 1
  }
  return i
}
