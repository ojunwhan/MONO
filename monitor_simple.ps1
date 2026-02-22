# monitor_simple.ps1
$logPath = ".\server.log"

# server.log가 생길 때까지 대기 (파일이 없어서 에러 나는 것 방지)
while (-not (Test-Path $logPath)) {
  Write-Host "waiting for server.log ... (start the server with: node server.js | Tee-Object -FilePath server.log )"
  Start-Sleep -Seconds 1
}

# 실시간 모니터
Get-Content $logPath -Wait -Tail 0 |
  ForEach-Object {
    $line = $_.ToString()
    $ts = (Get-Date).ToString("HH:mm:ss")

    # 이벤트 판정
    if ($line -match "\[JOIN EVENT\]|\[join\]") { $event = "JOIN" }
    elseif ($line -match "\[stt_chunk\]") { $event = "STT_CHUNK" }
    elseif ($line -match "\[stt_partial\]") { $event = "STT_PARTIAL" }
    elseif ($line -match "\[stt_final\]") { $event = "STT_FINAL" }
    else { $event = "OTHER" }

    # room 추출 (여러 포맷에 유연하게 대응)
    $room = "-"
    $m = [regex]::Match($line, 'roomId[:=]\s*["'']?([^"'\s,}]+)', 'IgnoreCase')
    if ($m.Success) { $room = $m.Groups[1].Value }
    else {
      $m2 = [regex]::Match($line, 'room=([A-Za-z0-9_\-]+)', 'IgnoreCase')
      if ($m2.Success) { $room = $m2.Groups[1].Value }
    }

    # lang 추출
    $lang = "-"
    $m = [regex]::Match($line, 'fromLang[:=]\s*["'']?([^"'\s,}]+)', 'IgnoreCase')
    if ($m.Success) { $lang = $m.Groups[1].Value }
    else {
      $m2 = [regex]::Match($line, 'lang[:=]\s*["'']?([^"'\s,}]+)', 'IgnoreCase')
      if ($m2.Success) { $lang = $m2.Groups[1].Value }
    }

    # socketId 추출
    $sid = "-"
    $m = [regex]::Match($line, 'socketId[:=]\s*["'']?([^"'\s,}]+)', 'IgnoreCase')
    if ($m.Success) { $sid = $m.Groups[1].Value }

    # 출력
    Write-Output ("{0} | {1} | room:{2} | lang:{3} | socket:{4} | {5}" -f $ts, $event, $room, $lang, $sid, ($line.Trim()))
  }
