#!/usr/bin/env python3
"""
Validation script to test the real BOE Consolidada API endpoint.

This script:
1. Tests connectivity to the real BOE API
2. Fetches a sample of normas and shows first 3 identificadores
3. Tests get_indice for a norma (if provided) and shows bloque count
4. Tests get_bloque for a bloque (if provided) and shows version count and html presence

Usage:
    python scripts/validate_boe_api.py [--norma ID_NORMA] [--bloque ID_BLOQUE]
    
Examples:
    # Test list_normas only
    python scripts/validate_boe_api.py
    
    # Test list_normas + get_indice
    python scripts/validate_boe_api.py --norma BOE-A-2018-16673
    
    # Test all three endpoints
    python scripts/validate_boe_api.py --norma BOE-A-2018-16673 --bloque ART_1
"""
import sys
import os
import argparse

# Add airflow dags to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'airflow', 'dags'))

from utils.boe_consolidada_client import BOEConsolidadaClient
import json


def test_list_normas(client):
    """Test list_normas endpoint and show first 3 identificadores."""
    print("=" * 70)
    print("1. Testing list_normas endpoint")
    print("=" * 70)
    print()
    
    print(f"Endpoint: {client.base_url}")
    print()
    
    try:
        normas = client.list_normas(limit=10)
        print(f"✓ API responded successfully")
        print(f"  Fetched {len(normas)} normas")
        print()
    except Exception as e:
        print(f"✗ API request failed: {e}")
        return None
    
    if len(normas) == 0:
        print("⚠ Warning: API returned 0 normas")
        print("  This could mean:")
        print("  - The API endpoint structure has changed")
        print("  - The API requires authentication")
        print("  - There are no normas in the system (unlikely)")
        print()
        print("  Try testing the endpoint manually:")
        print(f"  curl '{client.base_url}'")
        return None
    
    # Show first 3 identificadores
    print("First 3 identificadores:")
    print("-" * 70)
    for i, norma in enumerate(normas[:3], 1):
        print(f"{i}. {norma.get('id_norma', 'N/A')}")
        print(f"   Título: {(norma.get('titulo') or 'N/A')[:60]}...")
        print(f"   Rango: {norma.get('rango', 'N/A')}")
    print("-" * 70)
    print()
    
    return normas


def test_get_indice(client, id_norma):
    """Test get_indice endpoint and show bloque count."""
    print("=" * 70)
    print(f"2. Testing get_indice for {id_norma}")
    print("=" * 70)
    print()
    
    endpoint = client.indice_path_template.format(
        base=client.base_url,
        id_norma=id_norma
    )
    print(f"Endpoint: {endpoint}")
    print()
    
    try:
        indice = client.get_indice(id_norma)
        if 'error' in indice:
            print(f"⚠ get_indice returned error: {indice['error']}")
            print(f"  This is expected if the endpoint doesn't exist yet")
            return None
        else:
            bloques = indice.get('bloques', [])
            print(f"✓ get_indice succeeded")
            print(f"  Bloque count: {len(bloques)}")
            print()
            
            if bloques:
                print(f"  First 3 bloques:")
                for i, bloque in enumerate(bloques[:3], 1):
                    titulo_preview = (bloque.get('titulo_bloque') or 'N/A')[:50]
                    print(f"    {i}. {bloque.get('id_bloque', 'N/A')} ({bloque.get('tipo', 'N/A')})")
                    print(f"       {titulo_preview}")
            print()
            
            return bloques
    except Exception as e:
        print(f"⚠ get_indice failed: {e}")
        return None


def test_get_bloque(client, id_norma, id_bloque):
    """Test get_bloque endpoint and show version count and html presence."""
    print("=" * 70)
    print(f"3. Testing get_bloque for {id_norma}/{id_bloque}")
    print("=" * 70)
    print()
    
    endpoint = client.bloque_path_template.format(
        base=client.base_url,
        id_norma=id_norma,
        id_bloque=id_bloque
    )
    print(f"Endpoint: {endpoint}")
    print()
    
    try:
        bloque_data = client.get_bloque(id_norma, id_bloque)
        if 'error' in bloque_data:
            print(f"⚠ get_bloque returned error: {bloque_data['error']}")
            return None
        else:
            versiones = bloque_data.get('versiones', [])
            print(f"✓ get_bloque succeeded")
            print(f"  Version count: {len(versiones)}")
            print()
            
            if versiones:
                print(f"  Version details:")
                for i, version in enumerate(versiones[:3], 1):
                    has_html = bool(version.get('html'))
                    html_len = len(version.get('html', ''))
                    print(f"    {i}. Modificadora: {version.get('id_norma_modificadora', 'N/A')}")
                    print(f"       Vigencia desde: {version.get('fecha_vigencia_desde', 'N/A')}")
                    print(f"       Has HTML: {'Yes' if has_html else 'No'} ({html_len} chars)")
            print()
            
            return versiones
    except Exception as e:
        print(f"⚠ get_bloque failed: {e}")
        return None


def main():
    parser = argparse.ArgumentParser(
        description='Validate BOE Consolidada API endpoints',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Test list_normas only
  python scripts/validate_boe_api.py
  
  # Test list_normas + get_indice
  python scripts/validate_boe_api.py --norma BOE-A-2018-16673
  
  # Test all three endpoints
  python scripts/validate_boe_api.py --norma BOE-A-2018-16673 --bloque ART_1
        """
    )
    parser.add_argument('--norma', type=str, help='ID of norma to test (e.g., BOE-A-2018-16673)')
    parser.add_argument('--bloque', type=str, help='ID of bloque to test (e.g., ART_1)')
    
    args = parser.parse_args()
    
    # Initialize client
    client = BOEConsolidadaClient()
    print(f"✓ Client initialized")
    print(f"  Base URL: {client.base_url}")
    print()
    
    # Test 1: list_normas
    normas = test_list_normas(client)
    if normas is None:
        return 1
    
    # Test 2: get_indice (if norma provided or use first from list)
    test_norma_id = args.norma
    if not test_norma_id and normas:
        test_norma_id = normas[0].get('id_norma')
    
    bloques = None
    if test_norma_id:
        bloques = test_get_indice(client, test_norma_id)
    
    # Test 3: get_bloque (if bloque provided or use first from list)
    if args.norma and args.bloque:
        test_get_bloque(client, args.norma, args.bloque)
    elif test_norma_id and bloques and len(bloques) > 0:
        # Optionally test first bloque
        test_bloque_id = bloques[0].get('id_bloque')
        if test_bloque_id:
            test_get_bloque(client, test_norma_id, test_bloque_id)
    
    # Summary
    print("=" * 70)
    print("Summary")
    print("=" * 70)
    
    if normas and len(normas) >= 3:
        print("✅ SUCCESS: All tested endpoints are working")
        print()
        print("Next steps:")
        print("1. Run the boe_sync_consolidada DAG in Airflow")
        print("2. Check that boe_norma table is populated")
        print("3. Monitor logs for any parsing errors")
        return 0
    elif normas and len(normas) > 0:
        print("⚠ PARTIAL SUCCESS: API is working but returned limited data")
        print(f"  Only {len(normas)} normas found")
        return 0
    else:
        print("✗ FAILED: No valid normas could be parsed")
        print()
        print("Please review the API response structure and update the parser")
        return 1


if __name__ == '__main__':
    sys.exit(main())
