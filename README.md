# lector — leer en voz alta las respuestas de Claude, con controles

Un mod para Claude Code (Windows) que lee en voz alta la respuesta de Claude cuando tú lo pides, con un panel para **pausar, seguir, atrasar y adelantar unos 10 segundos, y cambiar la velocidad**. Mientras lee, marca con **▶** la frase que suena dentro del mensaje del chat.

*English, in one line: a Claude Code mod for Windows that reads Claude's replies aloud with a control panel (pause, resume, about ±10 s, speed) and a ▶ marker on the sentence being read.*

## Instalación

En la terminal de Claude Code:

```
/plugin install lector --marketplace yesicaalfaro95-ship-it/claude-lector
```

Desde cualquier consola:

```
claude plugin install lector --marketplace yesicaalfaro95-ship-it/claude-lector
```

En la app de escritorio, donde `/plugin` no corre: haz clic en **+** junto al cuadro de texto, luego **Plugins**, **Add marketplace** con `yesicaalfaro95-ship-it/claude-lector`, y por último **Add plugin**.

## Uso

Escribe `/leer`. Lee la última respuesta de Claude y abre el panel **Lector**.

| Comando | Qué hace |
| --- | --- |
| `/leer` | Lee la última respuesta |
| `/leer 2` | Lee la penúltima (3 para la anterior, y así) |
| `/leer pausa` / `/leer seguir` | Pausa y sigue |
| `/leer atras` / `/leer adelante` | Mueve la lectura unos 10 s |
| `/leer parar` | Detiene la lectura |
| `/leer panel` | Abre el panel sin leer |

El panel tiene los mismos controles en botones, una barra de avance, la frase que suena y **Más lento / Más rápido**. Al cambiar la velocidad la voz sigue desde la palabra donde iba.

## Qué lee y qué no

Quita el formato antes de hablar: no lee los `**`, las tablas, los bloques de código, los enlaces (solo su texto) ni los emojis. Dice "centímetros" en vez de "cm".

## Requisitos

- Windows 10 u 11 con PowerShell 5.1 o más nuevo.
- Una voz de Windows instalada. Usa **Microsoft Sabina Desktop** (español, México); si no está, usa la voz predeterminada. Para cambiarla, edita la constante `VOICE` en `hooks/register.tsx`.
- Claude Code 2.1.309 o parecida. La API de mods está en acceso temprano y cambia entre versiones.

## Límites conocidos

- Los "10 s" son aproximados: la voz no tiene segundos que recorrer, así que se saltan las frases que caben en unos 10 s a la velocidad actual.
- La marca ▶ va a la línea del mensaje donde empieza la frase; puede quedar al inicio de la línea si esa tiene formato.
- Si la frase que suena junta partes de dos bloques de un mismo mensaje, esa vez no se dibuja la marca.
- Solo Windows: la voz se maneja con PowerShell y `System.Speech`.

## Cómo funciona

`hooks/register.tsx` define el comando, el panel y la marca en el chat. `hooks/speak.ps1` es el proceso que habla: recibe las frases por entrada estándar y obedece órdenes que se escriben en un archivo temporal dentro de `%TEMP%\claude-lector-<pid>`, que borra al terminar. Se lanza con `-ExecutionPolicy Bypass` solo para ese proceso, sin cambiar la configuración del sistema. `hooks/sentences.ts` limpia el texto y lo parte en frases.

## Pruebas

```
claude plugin test .
claude plugin validate .
```

Las pruebas cubren la limpieza del texto, los saltos de 10 s, el panel y el flujo de `/leer` con una voz simulada. El script de voz se probó aparte con audio real: pausa, saltar estando en pausa, seguir y cambiar la velocidad.

## Licencia

MIT. Ver [LICENSE](LICENSE).
