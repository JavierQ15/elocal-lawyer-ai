# Initialize Ollama with embedding and chat models used by this repo.

Write-Host "Waiting for Ollama to be ready..." -ForegroundColor Yellow

$maxAttempts = 30
$attempt = 0

while ($attempt -lt $maxAttempts) {
    $null = docker compose exec ollama ollama list 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Ollama is ready." -ForegroundColor Green
        break
    }

    Write-Host "Ollama is not ready yet ($attempt/$maxAttempts)..." -ForegroundColor Gray
    Start-Sleep -Seconds 2
    $attempt++
}

if ($attempt -eq $maxAttempts) {
    Write-Host "Error: Ollama did not respond after $maxAttempts attempts." -ForegroundColor Red
    exit 1
}

Write-Host "Pulling embedding model qwen3-embedding:8b..." -ForegroundColor Yellow
docker compose exec ollama ollama pull qwen3-embedding:8b
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error pulling embedding model." -ForegroundColor Red
    exit 1
}

Write-Host "Pulling chat model qwen2.5:7b-instruct..." -ForegroundColor Yellow
docker compose exec ollama ollama pull qwen2.5:7b-instruct
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error pulling chat model." -ForegroundColor Red
    exit 1
}

Write-Host "Models installed. Available models:" -ForegroundColor Green
docker compose exec ollama ollama list
