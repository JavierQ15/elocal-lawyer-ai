# Known Issues and Limitations

## BOE API Limitations

### Block-level Content Not Available for Some Normas

**Issue**: The BOE Consolidated Legislation API provides the index (table of contents/structure) of legal norms but does not always provide access to individual block content through the `/texto/bloque/{id_bloque}` endpoint.

**Symptoms**:
- All blocks for a norma return HTTP 400 Bad Request
- Logs show: `"Failed to fetch content for X/Y bloques (100%)"`
- Particularly affects autonomous community norms (BOA, BOC, BOG, etc.)

**Affected Normas**:
- BOA-d-1991-90001 (Boletín Oficial de Aragón)
- Potentially other autonomous community legislation

**Cause**:
The BOE API's block endpoint (`/texto/bloque/{id_bloque}`) either:
1. Does not support block-level access for autonomous community norms
2. Requires different authentication or parameters not currently implemented
3. Only provides structure/index but not actual content via API

**Current Workaround**:
The application logs these failures and continues processing. The normas are recorded in the database but have no fragmented content for RAG queries.

**Alternative Data Sources**:
Each norma has a `url_html_consolidada` field pointing to the full HTML version:
```
https://www.boe.es/buscar/act.php?id={id_norma}
```

This HTML version IS accessible and contains the full text.

**Potential Solutions**:

1. **HTML Scraping (Recommended)**:
   - Fetch the `url_html_consolidada` 
   - Parse the HTML to extract article/block content
   - Map the HTML structure to the index structure
   - Store as versiones and fragmentos

2. **Selective Processing**:
   - Detect when all blocks for a norma fail
   - Mark norma as `requires_html_scraping = true`
   - Create a separate DAG/task to process these normas differently

3. **API Investigation**:
   - Contact BOE to clarify API capabilities
   - Check if there are undocumented parameters or authentication requirements
   - Verify if autonomous community norms require different endpoints

## Recommendations for Users

### For Queries
- Be aware that autonomous community legislation may have limited or no content indexed
- The norma metadata (title, dates, department) will still be searchable
- Consider manual review of important autonomous norms

### For Deployment
- Monitor the failure rate logs in Airflow
- If failure rate for a sync run exceeds 50%, investigate the affected normas
- Consider implementing HTML scraping for critical missing content

## Future Enhancements
- [ ] Implement HTML scraping fallback for normas with API access issues
- [ ] Add norma quality metrics (has_blocks, has_content, content_source)
- [ ] Create dashboard showing content availability by jurisdiction
- [ ] Automated detection and retry with HTML scraping

## Performance Optimizations

### Parallel HTTP Requests (Implemented)

The BOE sync process now uses parallel HTTP requests via `ThreadPoolExecutor` to significantly improve performance:

**Before**: Sequential processing (~1 request per second)
**After**: Parallel processing with configurable workers (default: 10 concurrent requests)

**Configuration**:
Set the `BOE_SYNC_PARALLEL_WORKERS` environment variable to adjust concurrency:
```bash
# In docker-compose.yml or .env
BOE_SYNC_PARALLEL_WORKERS=10  # Default
BOE_SYNC_PARALLEL_WORKERS=20  # More aggressive (use caution)
BOE_SYNC_PARALLEL_WORKERS=5   # Conservative (if API rate limiting occurs)
```

**What's parallelized**:
1. `sync_indices`: Fetching indices for multiple normas simultaneously
2. `sync_bloques_batch`: Fetching bloque content for multiple blocks simultaneously

**Performance impact**:
- 100 normas with 50 bloques each = 5,000 API calls
- Sequential: ~83 minutes (1 req/sec)
- Parallel (10 workers): ~8-10 minutes (10x speedup)

**Notes**:
- Database operations remain sequential to avoid conflicts
- If you encounter rate limiting (HTTP 429), reduce `MAX_PARALLEL_WORKERS`

### Automatic Retry with Exponential Backoff (Implemented)

The HTTP client now includes automatic retry logic to handle transient network errors:

**Retry Strategy**:
- Total retries: 5 attempts
- Backoff factor: 2 (waits 2^retry seconds between attempts: 1s, 2s, 4s, 8s, 16s)
- Status codes that trigger retry: 429 (Too Many Requests), 500, 502, 503, 504

**Error Classification**:
1. **Connection Errors**: Network connectivity issues, server refused connection
2. **Timeout Errors**: Request took too long to complete
3. **HTTP Errors**: 4xx/5xx status codes
4. **Unknown Errors**: Unexpected exceptions

**What gets retried**:
- Transient network errors (connection reset, server disconnected)
- Server overload errors (429, 503)
- Temporary server errors (500, 502, 504)

**What does NOT get retried**:
- 400 Bad Request (indicates block not available via API)
- 404 Not Found (indicates resource doesn't exist)
- Client errors (invalid JSON, authentication issues)

**Configuration**:
Connection pool settings in `boe_consolidada_client.py`:
```python
pool_connections=20  # Number of connection pools
pool_maxsize=50      # Max connections per pool
```

## Historical Data Synchronization

### Connection Errors During Large Syncs

**Issue**: When synchronizing large date ranges (e.g., 1800-2024), you may encounter connection errors:
```
Connection aborted, RemoteDisconnected('Remote end closed connection without response')
```

**Cause**:
1. **Too Many Concurrent Requests**: Even with retry logic, overwhelming the BOE API with thousands of concurrent requests can cause the server to drop connections
2. **Long-Running Connections**: Extended sync operations may exceed server connection timeouts
3. **Network Instability**: Transient network issues compound over long sync operations
4. **API Rate Limiting**: Implicit rate limiting not exposed via HTTP 429 but manifested as dropped connections

**Solution: Monthly Batching Strategy**

Instead of syncing all historical data in one run, use monthly batches:

```bash
# Sync one year month by month
make sync-historical-year YEAR=2023

# Or specify date range
make sync-historical-monthly START=2020-01 END=2024-12

# For very old data (pre-2000), smaller batches recommended
python scripts/sync_historical_monthly.py --start 1800-01 --end 1850-12
```

**Why Monthly Batching Works**:
1. **Smaller Request Volume**: Each month triggers a separate DAG run with manageable request count
2. **Natural Checkpoints**: If a month fails, you know exactly which period to retry
3. **Better Error Isolation**: One failed month doesn't invalidate entire historical sync
4. **Progress Visibility**: Clear progress tracking (e.g., "18/24 months completed")
5. **Resource Management**: Airflow can clean up resources between DAG runs

**Recommended Approach for Historical Sync**:

```bash
# Phase 1: Recent data first (most important, likely to have more normas)
make sync-historical-year YEAR=2024
make sync-historical-year YEAR=2023
make sync-historical-year YEAR=2022

# Phase 2: Work backwards by decade
make sync-historical-monthly START=2010-01 END=2019-12
make sync-historical-monthly START=2000-01 END=2009-12
make sync-historical-monthly START=1990-01 END=1999-12

# Phase 3: Historical data (sparse, lower priority)
make sync-historical-monthly START=1800-01 END=1989-12
```

**Handling Failed Periods**:

The historical sync script provides a summary with failed periods:
```
Failed periods:
  - 2023-05-01 to 2023-05-31
  - 2023-08-01 to 2023-08-31

You can retry failed periods individually:
  make trigger-sync FROM=2023-05-01 TO=2023-05-31
  make trigger-sync FROM=2023-08-01 TO=2023-08-31
```

**Monitoring**:
- Check Airflow logs for each monthly DAG run
- Monitor failure rate: if a month has >50% block fetch failures, investigate
- Use Airflow UI to track DAG run status and duration

**Best Practices**:
1. Start with recent years (more valuable data, test the system)
2. Schedule historical sync during off-peak hours
3. Monitor first few months to validate configuration
4. Keep `MAX_PARALLEL_WORKERS` at default (10) for historical sync
5. If encountering persistent connection errors, reduce to 5 workers
6. Weekly historical sync is reasonable (run monthly batches for one year per week)

**Alternative for Fire-and-Forget**:
If you don't want to wait for each month to complete:
```bash
python scripts/sync_historical_monthly.py --start 2020-01 --end 2020-12 --no-wait
```
This triggers all months immediately without monitoring. Check Airflow UI for results.
- Monitor Airflow logs for fetch completion percentages
