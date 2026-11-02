# Lector de voz: habla frases con la voz de Windows y obedece comandos de un archivo.
# Entrada (stdin, UTF-8): {"sentences":[...],"start":0,"rate":0,"voice":"..."}
# Salida (stdout, ASCII): READY <archivo de comandos> | S <n> | R <posicion> | END | ERR <texto>
# S: empieza la frase n. R: al cambiar la velocidad, siguio desde esa posicion de la frase.
# Comandos (archivo): "<n> goto <i>" | "<n> pause" | "<n> resume" | "<n> rate <r>" | "<n> stop"
$ErrorActionPreference = 'Stop'

function Out-Line([string]$text) {
  [Console]::Out.WriteLine($text)
  [Console]::Out.Flush()
}

$dir = $null
$synth = $null
try {
  Add-Type -AssemblyName System.Speech

  $stdin = [Console]::OpenStandardInput()
  $ms = New-Object System.IO.MemoryStream
  $stdin.CopyTo($ms)
  $raw = [System.Text.Encoding]::UTF8.GetString($ms.ToArray()).TrimStart([char]0xFEFF)
  $job = $raw | ConvertFrom-Json
  $sent = @($job.sentences)

  $dir = Join-Path ([System.IO.Path]::GetTempPath()) ('claude-lector-' + $PID)
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $cmdPath = Join-Path $dir 'cmd.txt'
  [System.IO.File]::WriteAllText($cmdPath, '', (New-Object System.Text.UTF8Encoding($false)))

  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  if ($job.voice) { try { $synth.SelectVoice([string]$job.voice) } catch {} }
  $synth.Rate = [int]$job.rate

  $i = [int]$job.start
  $paused = $false
  $seen = ''
  $prompt = $null
  # Donde va la voz dentro de la frase: se vuelve a leer al cambiar la velocidad.
  $offset = 0
  $charPos = 0
  Register-ObjectEvent -InputObject $synth -EventName SpeakProgress -SourceIdentifier 'lector-prog' | Out-Null

  function Start-Sentence([int]$n, [int]$from = 0) {
    $script:i = $n
    $script:offset = $from
    $script:charPos = $from
    $words = [string]$sent[$n]
    if ($from -gt 0) { $words = $words.Substring($from) }
    $script:prompt = $synth.SpeakAsync($words)
    if ($from -eq 0) { Out-Line ("S " + $n) }
  }

  Out-Line ('READY ' + $cmdPath)
  if ($sent.Count -eq 0 -or $i -ge $sent.Count) { Out-Line 'END'; return }
  Start-Sentence $i

  while ($true) {
    Start-Sleep -Milliseconds 80

    # Cada palabra avisa donde esta; solo cuenta la de la frase que suena ahora.
    foreach ($ev in @(Get-Event | Where-Object { $_.SourceIdentifier -eq 'lector-prog' })) {
      $ea = $ev.SourceEventArgs
      if ([object]::ReferenceEquals($ea.Prompt, $prompt)) { $charPos = $offset + $ea.CharacterPosition }
      Remove-Event -EventIdentifier $ev.EventIdentifier
    }

    # Se abre compartido para que quien escribe el comando nunca choque con esta lectura.
    $text = ''
    try {
      $fs = [System.IO.File]::Open($cmdPath, 'Open', 'Read', 'ReadWrite,Delete')
      try { $text = (New-Object System.IO.StreamReader($fs)).ReadToEnd().Trim() } finally { $fs.Dispose() }
    } catch { $text = '' }
    if ($text -ne '' -and $text -ne $seen -and $text -match '^\d+ (goto|pause|resume|rate|stop)( -?\d+)?$') {
      $seen = $text
      $parts = $text.Split(' ')
      switch ($parts[1]) {
        'pause'  { $synth.Pause(); $paused = $true }
        'resume' { $synth.Resume(); $paused = $false }
        'rate'   {
          # SAPI no cambia la velocidad a media frase: se dice de nuevo desde la palabra donde iba.
          $synth.Rate = [int]$parts[2]
          $from = $charPos
          if ($from -ge ([string]$sent[$i]).Length) { $from = 0 }
          $synth.SpeakAsyncCancelAll()
          Start-Sentence $i $from
          if ($from -gt 0) { Out-Line ('R ' + $from) }
        }
        'goto'   {
          $target = [int]$parts[2]
          $synth.SpeakAsyncCancelAll()
          if ($target -ge $sent.Count) { Out-Line 'END'; break }
          Start-Sentence $target
        }
        'stop'   { $synth.SpeakAsyncCancelAll(); Out-Line 'END'; break }
      }
      if ($parts[1] -eq 'stop' -or ($parts[1] -eq 'goto' -and [int]$parts[2] -ge $sent.Count)) { break }
    }

    if (-not $paused -and $prompt -ne $null -and $prompt.IsCompleted) {
      if (($i + 1) -ge $sent.Count) { Out-Line 'END'; break }
      Start-Sentence ($i + 1)
    }
  }
}
catch {
  Out-Line ('ERR ' + ($_.Exception.Message -replace '[\r\n]+', ' '))
}
finally {
  try { Unregister-Event -SourceIdentifier 'lector-prog' -ErrorAction SilentlyContinue } catch {}
  if ($synth) { try { $synth.SpeakAsyncCancelAll() } catch {}; $synth.Dispose() }
  if ($dir) { try { Remove-Item -Recurse -Force $dir } catch {} }
}
