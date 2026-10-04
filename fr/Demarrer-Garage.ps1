$garageRoot = $PSScriptRoot
$garagePort = 5174
$garageListener = Get-NetTCPConnection -LocalPort $garagePort -State Listen -ErrorAction SilentlyContinue
if (-not $garageListener) {
    $garagePython = (Get-Command python -ErrorAction Stop).Source
    Start-Process -FilePath $garagePython -ArgumentList ('"' + (Join-Path $garageRoot 'server.py') + '"'), '--port', $garagePort -WorkingDirectory $garageRoot -WindowStyle Hidden
}
Write-Output "Garage Haojue : http://localhost:$garagePort/"
