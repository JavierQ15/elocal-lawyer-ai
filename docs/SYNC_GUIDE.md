# BOE Data Synchronization Guide

This guide provides best practices for synchronizing Spanish legislation data from the BOE (Boletín Oficial del Estado) Consolidated Legislation API.

## Table of Contents

1. [Synchronization Strategies](#synchronization-strategies)
2. [Error Handling](#error-handling)
3. [Performance Optimization](#performance-optimization)
4. [Historical Data Migration](#historical-data-migration)
5. [Monitoring and Troubleshooting](#monitoring-and-troubleshooting)

---

## Synchronization Strategies

### Incremental Sync (Recommended for Daily Operation)

For ongoing daily synchronization of recent legislation updates:

```bash
# Sync last 30 days
make trigger-sync FROM=2024-12-01 TO=2024-12-31

# Sync current month (automated via Airflow schedule)
# The boe_sync_consolidada DAG is configured to run daily
```

**Use Cases**:
- Daily automated updates
- Keeping legislation database current
- Low resource overhead

**Characteristics**:
- Small date window (days to weeks)
- Fast execution (minutes)
- High reliability
- Low server load

### Monthly Batching (Recommended for Historical Data)

For synchronizing historical legislation data:

```bash
# Sync a specific year
make sync-historical-year YEAR=2023

# Sync a date range
make sync-historical-monthly START=2020-01 END=2024-12
```

**Use Cases**:
- Initial database population
- Backfilling historical data
- Recovering from extended outages

**Characteristics**:
- Medium date windows (monthly)
- Moderate execution time (10-30 min per month)
- Good error isolation
- Manageable API load

### Full Historical Sync (Use with Caution)

**❌ NOT Recommended**:
```bash
# This will likely fail with connection errors
make trigger-sync FROM=1800-01-01 TO=2024-12-31
```

**Why it fails**:
- Tens of thousands of API requests in one run
- Server connection exhaustion
- Long-running DAG execution (hours)
- No checkpointing if it fails midway
- Difficult to identify which normas/periods failed

**✅ Use This Instead**:
```bash
# Break into manageable yearly or monthly chunks
make sync-historical-year YEAR=2023
make sync-historical-year YEAR=2022
# ... and so on
```

---

## Error Handling

### Automatic Retry Mechanism

The BOE client implements automatic retry with exponential backoff:

**Retry Configuration**:
- **Total retries**: 5 attempts
- **Backoff factor**: 2 (waits 1s, 2s, 4s, 8s, 16s between retries)
- **Retryable status codes**: 429, 500, 502, 503, 504

**Error Types**:

| Error Type | Description | Automatically Retried | Action Required |
|------------|-------------|----------------------|----------------|
| `connection` | Network connectivity issues, server refused connection | ✅ Yes | Usually resolves automatically |
| `timeout` | Request exceeded timeout threshold | ✅ Yes | May indicate server overload |
| `http` | HTTP error responses (4xx, 5xx) | Depends on status | Check specific error code |
| `unknown` | Unexpected exceptions | ❌ No | Investigate logs |

### Non-Retryable Errors

**400 Bad Request** - Block not available via API:
```python
{'error': 'HTTP 400: Bad Request', 'error_type': 'http'}
```
This is expected for autonomous community norms (BOA, BOC, etc.). These normas have index data but no block content available through the API.

**404 Not Found** - Resource doesn't exist:
```python
{'error': 'HTTP 404: Not Found', 'error_type': 'http'}
```
The norma or block ID is invalid or has been removed.

### Manual Retry for Failed Periods

After a historical sync run, review failed periods and retry:

```bash
# Example output from sync_historical_monthly.py
# Failed periods:
#   - 2023-05-01 to 2023-05-31
#   - 2023-08-01 to 2023-08-31

# Retry individually
make trigger-sync FROM=2023-05-01 TO=2023-05-31
make trigger-sync FROM=2023-08-01 TO=2023-08-31
```

**When to retry**:
- Connection or timeout errors (these are transient)
- Server errors (500, 502, 503, 504)
- After reducing `MAX_PARALLEL_WORKERS` if rate limiting occurred

**When NOT to retry**:
- 400 errors for block content (API limitation, won't change)
- 404 errors (resource doesn't exist)
- Authentication errors (fix configuration first)

---

## Performance Optimization

### Parallel Request Configuration

Control the number of concurrent HTTP requests:

```bash
# In docker-compose.yml or .env file
BOE_SYNC_PARALLEL_WORKERS=10  # Default (balanced)
BOE_SYNC_PARALLEL_WORKERS=20  # Aggressive (may trigger rate limiting)
BOE_SYNC_PARALLEL_WORKERS=5   # Conservative (for unstable networks)
```

**Performance Impact**:

| Workers | Est. Time for 5000 Requests | Risk Level | Use Case |
|---------|---------------------------|------------|----------|
| 1 (sequential) | ~83 minutes | Very Low | Testing, debugging |
| 5 | ~15-20 minutes | Low | Unstable network, conservative |
| 10 (default) | ~8-10 minutes | Medium | Recommended for production |
| 20 | ~4-5 minutes | High | Fast but may hit rate limits |

**Tuning Guidelines**:

1. **Start with default (10 workers)**
2. **Monitor for errors**:
   - If seeing `429 Too Many Requests` → reduce workers
   - If seeing frequent `connection` errors → reduce workers
   - If seeing slow progress but no errors → increase workers
3. **Adjust and retest**

### Connection Pooling

The HTTP client uses connection pooling to reuse connections:

```python
pool_connections=20   # Number of connection pools
pool_maxsize=50      # Max connections per pool
```

**Benefits**:
- Reuses TCP connections (faster)
- Reduces server load
- Handles concurrent requests efficiently

**When to adjust**:
- Increase `pool_maxsize` if you increase `MAX_PARALLEL_WORKERS` above 20
- Increase `pool_connections` if syncing from multiple Airflow workers

---

## Historical Data Migration

### Recommended Phased Approach

**Phase 1: Recent Data (Most Important)**
```bash
# Start with the last 5 years (most actively used legislation)
make sync-historical-year YEAR=2024
make sync-historical-year YEAR=2023
make sync-historical-year YEAR=2022
make sync-historical-year YEAR=2021
make sync-historical-year YEAR=2020
```

**Reasoning**:
- Recent legislation is most queried
- Validates your setup with current data
- Provides immediate value for users

**Phase 2: Recent Decades**
```bash
# Work backwards by decades
make sync-historical-monthly START=2010-01 END=2019-12  # 2010s
make sync-historical-monthly START=2000-01 END=2009-12  # 2000s
make sync-historical-monthly START=1990-01 END=1999-12  # 1990s
make sync-historical-monthly START=1980-01 END=1989-12  # 1980s
```

**Reasoning**:
- High-value legislation from democratic era
- Manageable volume per decade
- Good checkpoint granularity

**Phase 3: Historical Archive (Lower Priority)**
```bash
# Pre-1980 data (sparse, archival)
make sync-historical-monthly START=1800-01 END=1979-12
```

**Reasoning**:
- Less frequently accessed
- Lower norma density
- Can be done during low-traffic periods

### Time Estimates

Assuming default configuration (10 parallel workers):

| Period | Approx. Months | Est. Time per Month | Total Time |
|--------|---------------|---------------------|------------|
| 2020-2024 | 60 | 10-15 min | 10-15 hours |
| 2010-2019 | 120 | 10-15 min | 20-30 hours |
| 2000-2009 | 120 | 8-12 min | 16-24 hours |
| 1980-1999 | 240 | 5-10 min | 20-40 hours |
| 1800-1979 | ~2160 | 2-5 min | 72-180 hours |

**Total for complete historical sync**: ~140-300 hours (~6-12 days of continuous operation)

### Scheduling Strategy

**Option 1: One-Time Marathon** (Not Recommended)
- Run continuously for several days
- High risk of failures
- Requires constant monitoring

**Option 2: Daily Batches** (Recommended)
```bash
# Run during off-peak hours (e.g., midnight to 6 AM)
# Cron job to sync one year per night
0 0 * * * make sync-historical-year YEAR=2023
```

**Option 3: Weekly Blocks**
```bash
# Weekend batch processing
# Sync 5-10 years per weekend
```

---

## Monitoring and Troubleshooting

### Airflow UI Monitoring

1. **Access Airflow**: http://localhost:8080
2. **Navigate to**: DAGs → `boe_sync_consolidada`
3. **Check**:
   - ✅ Green = Success
   - 🔴 Red = Failed (requires retry)
   - ⏳ Light Green = Running

### Log Analysis

**Check DAG logs**:
```bash
# View Airflow logs
make logs-airflow

# Or view specific DAG run logs in Airflow UI
```

**Key Log Patterns**:

**Successful sync**:
```
INFO - Discovered X normas
INFO - Successfully synced Y indices
INFO - Fetched Z/W bloques successfully (success rate: 85%)
```

**Connection errors** (requires retry):
```
ERROR - Connection error fetching bloque: Connection aborted
ERROR - Timeout fetching bloque: Read timed out
```

**API limitation** (expected for BOA normas):
```
WARNING - Failed to fetch content for 98/98 bloques (100%)
ERROR - HTTP 400: Bad Request
```

### Common Issues and Solutions

| Issue | Symptoms | Solution |
|-------|----------|----------|
| Rate limiting | Many 429 errors | Reduce `BOE_SYNC_PARALLEL_WORKERS` to 5 |
| Connection drops | "RemoteDisconnected" errors | Use monthly batching, reduce workers |
| Slow progress | Long execution time, no errors | Increase `BOE_SYNC_PARALLEL_WORKERS` to 15-20 |
| 100% block failures | All blocks return 400 for a norma | Expected for BOA normas (API limitation) |
| DAG timeout | DAG killed after hours | Use smaller date windows (monthly) |

### Health Checks

**Verify sync health**:
```bash
# Check PostgreSQL data
make shell-postgres

# Count synced normas
SELECT COUNT(*) FROM normas;

# Count synced bloques
SELECT COUNT(*) FROM bloques;

# Check normas without blocks (may indicate issues or BOA normas)
SELECT id_norma, titulo FROM normas 
WHERE id_norma NOT IN (SELECT DISTINCT id_norma FROM bloques);
```

**API health**:
```bash
# Test BOE API availability
python scripts/validate_boe_api.py
```

---

## Quick Reference

### Commands Cheat Sheet

```bash
# Daily sync (current month)
# (Automated via Airflow schedule)

# Sync specific date range
make trigger-sync FROM=2024-01-01 TO=2024-01-31

# Historical sync - one year
make sync-historical-year YEAR=2023

# Historical sync - date range
make sync-historical-monthly START=2020-01 END=2024-12

# Retry failed period
make trigger-sync FROM=2023-05-01 TO=2023-05-31

# View logs
make logs-airflow

# Check database
make shell-postgres
```

### Environment Variables

```bash
# Parallel workers (default: 10)
BOE_SYNC_PARALLEL_WORKERS=10

# Airflow credentials
AIRFLOW_USERNAME=admin
AIRFLOW_PASSWORD=admin

# API URL
AIRFLOW_API_URL=http://localhost:8080/api/v1
```

### Python Script Options

```bash
# Historical sync script
python scripts/sync_historical_monthly.py \
  --start 2020-01 \
  --end 2024-12 \
  --skip-existing \     # Skip already synced periods
  --no-wait            # Don't wait for completion (fire and forget)
```

---

## Best Practices Summary

1. ✅ **Use monthly batching for historical data**
2. ✅ **Start with recent years, work backwards**
3. ✅ **Use default parallel workers (10) initially**
4. ✅ **Monitor first few months before full sync**
5. ✅ **Retry failed periods individually**
6. ✅ **Schedule historical sync during off-peak hours**
7. ❌ **Don't sync entire history in one DAG run**
8. ❌ **Don't ignore 100% failure rates (investigate)**
9. ❌ **Don't increase workers aggressively without testing**
10. ❌ **Don't retry 400 errors for block content**
