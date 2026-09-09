param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$Output,
  [Parameter(Mandatory = $true)][int]$Width,
  [Parameter(Mandatory = $true)][int]$Height
)

$ErrorActionPreference = 'Stop'
$edgePath = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$profilePath = Join-Path ([System.IO.Path]::GetTempPath()) ("frank-mockup-edge-{0}" -f [guid]::NewGuid().ToString('N'))
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

function Send-Cdp {
  param($Socket, [int]$Id, [string]$Method, $Params = @{})
  $json = @{ id = $Id; method = $Method; params = $Params } | ConvertTo-Json -Compress -Depth 10
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $segment = [System.ArraySegment[byte]]::new($bytes)
  $Socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
}

function Receive-Cdp {
  param($Socket, [int]$Id)
  while ($true) {
    $stream = [System.IO.MemoryStream]::new()
    do {
      $buffer = [byte[]]::new(65536)
      $segment = [System.ArraySegment[byte]]::new($buffer)
      $result = $Socket.ReceiveAsync($segment, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
      $stream.Write($buffer, 0, $result.Count)
    } until ($result.EndOfMessage)
    $message = [System.Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
    if ($message.id -eq $Id) { return $message }
  }
}

$edge = $null
$socket = $null
try {
  New-Item -ItemType Directory -Path $profilePath | Out-Null
  $arguments = @(
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    "--remote-debugging-port=$port",
    "--user-data-dir=$profilePath",
    'about:blank'
  )
  $edge = Start-Process -FilePath $edgePath -ArgumentList $arguments -PassThru -WindowStyle Hidden

  $version = $null
  for ($attempt = 0; $attempt -lt 50 -and -not $version; $attempt++) {
    try { $version = Invoke-RestMethod "http://127.0.0.1:$port/json/version" } catch { Start-Sleep -Milliseconds 100 }
  }
  if (-not $version) { throw 'Edge debugging endpoint did not start.' }

  $target = Invoke-RestMethod -Method Put "http://127.0.0.1:$port/json/new?about:blank"
  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  $socket.ConnectAsync([uri]$target.webSocketDebuggerUrl, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null

  Send-Cdp $socket 1 'Page.enable'
  Receive-Cdp $socket 1 | Out-Null
  Send-Cdp $socket 2 'Emulation.setDeviceMetricsOverride' @{ width = $Width; height = $Height; deviceScaleFactor = 1; mobile = ($Width -le 760); screenWidth = $Width; screenHeight = $Height }
  Receive-Cdp $socket 2 | Out-Null
  Send-Cdp $socket 3 'Page.navigate' @{ url = $Url }
  Receive-Cdp $socket 3 | Out-Null
  Send-Cdp $socket 4 'Runtime.evaluate' @{ expression = "new Promise(resolve => { const done = () => setTimeout(resolve, 1200); document.fonts ? document.fonts.ready.then(done) : done(); })"; awaitPromise = $true; returnByValue = $true }
  Receive-Cdp $socket 4 | Out-Null
  Send-Cdp $socket 5 'Page.captureScreenshot' @{ format = 'png'; fromSurface = $true; captureBeyondViewport = $false }
  $capture = Receive-Cdp $socket 5
  if (-not $capture.result.data) { throw 'Screenshot capture returned no image.' }

  $outputPath = [System.IO.Path]::GetFullPath($Output)
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($outputPath)) | Out-Null
  [System.IO.File]::WriteAllBytes($outputPath, [Convert]::FromBase64String($capture.result.data))
}
finally {
  if ($socket) { $socket.Dispose() }
  if ($edge -and -not $edge.HasExited) { Stop-Process -Id $edge.Id -Force }
  $resolvedTemp = [System.IO.Path]::GetFullPath($profilePath)
  $allowedRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if ($resolvedTemp.StartsWith($allowedRoot) -and (Split-Path $resolvedTemp -Leaf).StartsWith('frank-mockup-edge-')) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
