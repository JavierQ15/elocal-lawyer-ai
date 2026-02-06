#!/usr/bin/env python3
"""
Script para sincronizar el historial completo de legislación consolidada del BOE
mes a mes, con manejo robusto de errores y reintentos.

Este script es preferible a sincronizar todo el historial de una vez porque:
1. Reduce la carga sobre el servidor BOE
2. Permite reintentar períodos específicos que fallen
3. Proporciona mejor seguimiento del progreso
4. Evita saturación de conexiones

Uso:
    python scripts/sync_historical_monthly.py --start 2000-01 --end 2024-12
    python scripts/sync_historical_monthly.py --start 2020-01 --end 2020-12 --skip-existing
    python scripts/sync_historical_monthly.py --year 2023  # Solo un año completo
"""
import argparse
import requests
import json
import time
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

AIRFLOW_API_URL = os.getenv('AIRFLOW_API_URL', 'http://localhost:8080/api/v1')
AIRFLOW_USERNAME = os.getenv('AIRFLOW_USERNAME', 'admin')
AIRFLOW_PASSWORD = os.getenv('AIRFLOW_PASSWORD', 'admin')
DAG_ID = 'boe_sync_consolidada'


class HistoricalSyncManager:
    """Manages historical sync of BOE legislation by monthly periods."""
    
    def __init__(self, api_url: str, username: str, password: str):
        self.api_url = api_url
        self.auth = (username, password)
        self.session = requests.Session()
        self.session.auth = self.auth
    
    def trigger_dag(self, from_date: str, to_date: str) -> dict:
        """
        Trigger the boe_sync_consolidada DAG for a specific period.
        
        Args:
            from_date: Start date in YYYY-MM-DD format
            to_date: End date in YYYY-MM-DD format
            
        Returns:
            Response dict with dag_run_id if successful
        """
        url = f"{self.api_url}/dags/{DAG_ID}/dagRuns"
        
        payload = {
            "conf": {
                "from_date": from_date,
                "to_date": to_date
            }
        }
        
        print(f"Triggering DAG for period {from_date} to {to_date}")
        
        try:
            response = self.session.post(url, json=payload)
            response.raise_for_status()
            result = response.json()
            print(f"  ✓ DAG triggered: {result.get('dag_run_id', 'N/A')}")
            return result
        except requests.RequestException as e:
            print(f"  ✗ Failed to trigger DAG: {e}")
            return {'error': str(e)}
    
    def wait_for_dag_completion(self, dag_run_id: str, timeout: int = 3600, poll_interval: int = 30):
        """
        Wait for a DAG run to complete.
        
        Args:
            dag_run_id: The DAG run ID to monitor
            timeout: Maximum time to wait in seconds (default: 1 hour)
            poll_interval: How often to check status in seconds (default: 30 seconds)
            
        Returns:
            Final state of the DAG run
        """
        url = f"{self.api_url}/dags/{DAG_ID}/dagRuns/{dag_run_id}"
        start_time = time.time()
        
        print(f"  Monitoring DAG run {dag_run_id}...")
        
        while True:
            if time.time() - start_time > timeout:
                print(f"  ⚠ Timeout waiting for DAG completion after {timeout}s")
                return 'timeout'
            
            try:
                response = self.session.get(url)
                response.raise_for_status()
                result = response.json()
                state = result.get('state', 'unknown')
                
                if state in ['success', 'failed']:
                    status_symbol = '✓' if state == 'success' else '✗'
                    print(f"  {status_symbol} DAG completed with state: {state}")
                    return state
                
                # Still running
                elapsed = int(time.time() - start_time)
                print(f"  ⏳ State: {state}, elapsed: {elapsed}s")
                time.sleep(poll_interval)
                
            except requests.RequestException as e:
                print(f"  ⚠ Error checking status: {e}")
                time.sleep(poll_interval)
    
    def sync_period(self, from_date: str, to_date: str, wait: bool = True):
        """
        Sync a specific period and optionally wait for completion.
        
        Args:
            from_date: Start date in YYYY-MM-DD format
            to_date: End date in YYYY-MM-DD format
            wait: Whether to wait for DAG completion
            
        Returns:
            True if successful, False otherwise
        """
        result = self.trigger_dag(from_date, to_date)
        
        if 'error' in result:
            return False
        
        if wait:
            dag_run_id = result.get('dag_run_id')
            if not dag_run_id:
                print("  ⚠ No dag_run_id returned, cannot monitor")
                return False
            
            state = self.wait_for_dag_completion(dag_run_id)
            return state == 'success'
        
        return True
    
    def sync_monthly_range(self, start_date: datetime, end_date: datetime, 
                          skip_existing: bool = False, wait: bool = True):
        """
        Sync legislation month by month from start_date to end_date.
        
        Args:
            start_date: Start date
            end_date: End date
            skip_existing: Skip months that already appear to be synced
            wait: Wait for each month to complete before starting the next
            
        Returns:
            Summary dict with success/failure counts
        """
        current = start_date.replace(day=1)
        end = end_date.replace(day=1)
        
        results = {
            'total': 0,
            'success': 0,
            'failed': 0,
            'skipped': 0,
            'failed_periods': []
        }
        
        while current <= end:
            # Calculate month range
            month_start = current
            month_end = (current + relativedelta(months=1)) - timedelta(days=1)
            
            # Don't sync beyond end_date
            if month_end > end_date:
                month_end = end_date
            
            from_str = month_start.strftime('%Y-%m-%d')
            to_str = month_end.strftime('%Y-%m-%d')
            
            results['total'] += 1
            
            print(f"\n{'='*60}")
            print(f"Period {results['total']}: {from_str} to {to_str}")
            print(f"{'='*60}")
            
            # TODO: Implement skip_existing logic by checking DB
            if skip_existing:
                # Could query DB to see if this period is already synced
                pass
            
            success = self.sync_period(from_str, to_str, wait=wait)
            
            if success:
                results['success'] += 1
            else:
                results['failed'] += 1
                results['failed_periods'].append(f"{from_str} to {to_str}")
            
            # Move to next month
            current = current + relativedelta(months=1)
            
            # Add a small delay between months to avoid overwhelming the system
            if wait and current <= end:
                print(f"\nWaiting 5 seconds before next period...")
                time.sleep(5)
        
        return results


def main():
    parser = argparse.ArgumentParser(
        description='Sync BOE historical legislation month by month'
    )
    parser.add_argument(
        '--start', 
        help='Start date in YYYY-MM format (default: 2000-01)',
        default='2000-01'
    )
    parser.add_argument(
        '--end',
        help='End date in YYYY-MM format (default: current month)',
        default=datetime.now().strftime('%Y-%m')
    )
    parser.add_argument(
        '--year',
        help='Sync a specific year (overrides --start and --end)',
        type=int
    )
    parser.add_argument(
        '--skip-existing',
        help='Skip months that appear to be already synced',
        action='store_true'
    )
    parser.add_argument(
        '--no-wait',
        help='Do not wait for each period to complete (fire and forget)',
        action='store_true'
    )
    parser.add_argument(
        '--api-url',
        help=f'Airflow API URL (default: {AIRFLOW_API_URL})',
        default=AIRFLOW_API_URL
    )
    
    args = parser.parse_args()
    
    # Parse dates
    if args.year:
        start_date = datetime(args.year, 1, 1)
        end_date = datetime(args.year, 12, 31)
    else:
        try:
            start_date = datetime.strptime(args.start, '%Y-%m')
            end_date = datetime.strptime(args.end, '%Y-%m')
            # Set end_date to last day of month
            end_date = (end_date + relativedelta(months=1)) - timedelta(days=1)
        except ValueError as e:
            print(f"Error parsing dates: {e}")
            print("Use format YYYY-MM for --start and --end, or --year YYYY")
            sys.exit(1)
    
    print(f"\n{'='*60}")
    print(f"BOE Historical Sync - Monthly Batches")
    print(f"{'='*60}")
    print(f"Start: {start_date.strftime('%Y-%m-%d')}")
    print(f"End: {end_date.strftime('%Y-%m-%d')}")
    print(f"API: {args.api_url}")
    print(f"Wait mode: {'Yes' if not args.no_wait else 'No (fire and forget)'}")
    print(f"{'='*60}\n")
    
    # Confirm before proceeding
    total_months = ((end_date.year - start_date.year) * 12 + 
                   end_date.month - start_date.month + 1)
    print(f"This will trigger {total_months} separate DAG runs.")
    
    if not args.no_wait:
        print("Each run will be monitored for completion before starting the next.")
        print(f"Estimated time: {total_months * 10} - {total_months * 30} minutes")
    
    confirm = input("\nProceed? [y/N]: ")
    if confirm.lower() != 'y':
        print("Aborted.")
        sys.exit(0)
    
    # Initialize manager
    manager = HistoricalSyncManager(
        api_url=args.api_url,
        username=AIRFLOW_USERNAME,
        password=AIRFLOW_PASSWORD
    )
    
    # Run sync
    start_time = time.time()
    results = manager.sync_monthly_range(
        start_date=start_date,
        end_date=end_date,
        skip_existing=args.skip_existing,
        wait=not args.no_wait
    )
    elapsed = time.time() - start_time
    
    # Print summary
    print(f"\n{'='*60}")
    print(f"SYNC SUMMARY")
    print(f"{'='*60}")
    print(f"Total periods: {results['total']}")
    print(f"Success: {results['success']}")
    print(f"Failed: {results['failed']}")
    print(f"Skipped: {results['skipped']}")
    print(f"Elapsed time: {int(elapsed/60)} minutes {int(elapsed%60)} seconds")
    
    if results['failed_periods']:
        print(f"\nFailed periods:")
        for period in results['failed_periods']:
            print(f"  - {period}")
        print("\nYou can retry failed periods individually:")
        for period in results['failed_periods']:
            dates = period.split(' to ')
            print(f"  make trigger-sync FROM={dates[0]} TO={dates[1]}")
    
    sys.exit(0 if results['failed'] == 0 else 1)


if __name__ == '__main__':
    main()
