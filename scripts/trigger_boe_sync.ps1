# Script PowerShell para ejecutar el DAG boe_sync_consolidada con parámetros personalizados
# Uso: .\trigger_boe_sync.ps1 -FromDate "2024-01-01" -ToDate "2024-01-31"

param(
    [string]$FromDate = "2024-01-01",
    [string]$ToDate = "2024-01-31"
)

Write-Host "Triggering boe_sync_consolidada DAG..." -ForegroundColor Green
Write-Host "From: $FromDate"
Write-Host "To: $ToDate"

$body = @{
    conf = @{
        from_date = $FromDate
        to_date = $ToDate
    }
} | ConvertTo-Json

$base64AuthInfo = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("admin:admin"))

try {
    $response = Invoke-RestMethod -Uri "http://localhost:8080/api/v1/dags/boe_sync_consolidada/dagRuns" `
        -Method POST `
        -Headers @{
            "Authorization" = "Basic $base64AuthInfo"
            "Content-Type" = "application/json"
        } `
        -Body $body
    
    Write-Host "`nDAG triggered successfully!" -ForegroundColor Green
    Write-Host "DAG Run ID: $($response.dag_run_id)"
    Write-Host "State: $($response.state)"
    Write-Host "`nCheck status at: http://localhost:8080/dags/boe_sync_consolidada/grid" -ForegroundColor Cyan
}
catch {
    Write-Host "`nError triggering DAG:" -ForegroundColor Red
    Write-Host $_.Exception.Message
}
