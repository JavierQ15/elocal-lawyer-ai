#!/bin/bash
# Script para ejecutar el DAG boe_sync_consolidada con parámetros personalizados
# Uso: ./trigger_boe_sync.sh [from_date] [to_date]
# Ejemplo: ./trigger_boe_sync.sh 2024-01-01 2024-01-31

FROM_DATE=${1:-"2024-01-01"}
TO_DATE=${2:-"2024-01-31"}

echo "Triggering boe_sync_consolidada DAG..."
echo "From: $FROM_DATE"
echo "To: $TO_DATE"

curl -X POST "http://localhost:8080/api/v1/dags/boe_sync_consolidada/dagRuns" \
  -H "Content-Type: application/json" \
  -u "admin:admin" \
  -d "{
    \"conf\": {
      \"from_date\": \"$FROM_DATE\",
      \"to_date\": \"$TO_DATE\"
    }
  }"

echo ""
echo "DAG triggered! Check status at: http://localhost:8080"
