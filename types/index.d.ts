export type LectorStatus = {
  /** `idle`: nada suena; `playing`: leyendo; `paused`: en pausa. */
  phase: 'idle' | 'playing' | 'paused'
  /** Frase que se lee ahora (desde 0). */
  index: number
  /** Cantidad de frases de la lectura. */
  total: number
  /** Velocidad de la voz, de -10 a 10; 0 es la normal. */
  rate: number
  /** La frase que se lee ahora, para mostrarla en el panel. */
  preview: string
  /** Aviso corto bajo el estado ("Terminó la lectura.", un error). */
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    lector: { status: Shaped<LectorStatus> }
  }
}
