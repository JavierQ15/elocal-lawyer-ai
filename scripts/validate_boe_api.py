#!/usr/bin/env python3
"""
Validation script to test the real BOE Consolidada API endpoint.

This script:
1. Tests connectivity to the real BOE API
2. Fetches a sample of normas
3. Verifies the parser produces valid results
4. Reports statistics

Usage:
    python scripts/validate_boe_api.py
"""
import sys
import os

# Add airflow dags to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'airflow', 'dags'))

from utils.boe_consolidada_client import BOEConsolidadaClient
import json


def main():
    print("=" * 70)
    print("BOE Consolidada API Validation")
    print("=" * 70)
    print()
    
    # Initialize client
    client = BOEConsolidadaClient()
    print(f"✓ Client initialized")
    print(f"  Base URL: {client.base_url}")
    print()
    
    # Test connectivity
    print("Testing API connectivity...")
    try:
        normas = client.list_normas(limit=10)
        print(f"✓ API responded successfully")
        print(f"  Fetched {len(normas)} normas")
        print()
    except Exception as e:
        print(f"✗ API request failed: {e}")
        return 1
    
    if len(normas) == 0:
        print("⚠ Warning: API returned 0 normas")
        print("  This could mean:")
        print("  - The API endpoint structure has changed")
        print("  - The API requires authentication")
        print("  - There are no normas in the system (unlikely)")
        print()
        print("  Try testing the endpoint manually:")
        print(f"  curl '{client.base_url}'")
        return 1
    
    # Analyze results
    print("Analyzing parsed normas...")
    print()
    
    valid_normas = 0
    missing_fields = {}
    
    for norma in normas:
        if norma.get('id_norma'):
            valid_normas += 1
        
        # Track missing fields
        for field in ['id_norma', 'titulo', 'rango', 'fecha_publicacion']:
            if not norma.get(field):
                missing_fields[field] = missing_fields.get(field, 0) + 1
    
    print(f"Valid normas: {valid_normas}/{len(normas)}")
    
    if missing_fields:
        print("\nMissing field statistics:")
        for field, count in missing_fields.items():
            print(f"  {field}: {count} normas missing")
    
    print()
    
    # Show sample norma
    if normas:
        print("Sample norma (first result):")
        print("-" * 70)
        sample = normas[0]
        print(f"  ID:          {sample.get('id_norma', 'N/A')}")
        print(f"  Título:      {(sample.get('titulo') or 'N/A')[:60]}...")
        print(f"  Rango:       {sample.get('rango', 'N/A')}")
        print(f"  Departamento: {sample.get('departamento', 'N/A')}")
        print(f"  Ámbito:      {sample.get('ambito', 'N/A')}")
        print(f"  F. Publicación: {sample.get('fecha_publicacion', 'N/A')}")
        print(f"  F. Actualización: {sample.get('fecha_actualizacion_api', 'N/A')}")
        print(f"  URL:         {sample.get('url_html_consolidada', 'N/A')}")
        print("-" * 70)
        print()
    
    # Test get_indice (if we have at least one norma)
    if valid_normas > 0:
        test_id = normas[0]['id_norma']
        print(f"Testing get_indice for {test_id}...")
        try:
            indice = client.get_indice(test_id)
            if 'error' in indice:
                print(f"⚠ get_indice returned error: {indice['error']}")
                print(f"  This is expected if the endpoint doesn't exist yet")
            else:
                bloques = indice.get('bloques', [])
                print(f"✓ get_indice succeeded")
                print(f"  Found {len(bloques)} bloques")
                
                if bloques:
                    print(f"\n  Sample bloques (first 3):")
                    for i, bloque in enumerate(bloques[:3]):
                        titulo_preview = (bloque.get('titulo_bloque') or 'N/A')[:50]
                        print(f"    {i+1}. {bloque.get('id_bloque', 'N/A')} - {bloque.get('tipo', 'N/A')}: {titulo_preview}...")
                
                # Test get_bloque if we have bloques
                if bloques and len(bloques) > 0:
                    test_bloque_id = bloques[0]['id_bloque']
                    print(f"\n  Testing get_bloque for {test_id}/{test_bloque_id}...")
                    try:
                        bloque_data = client.get_bloque(test_id, test_bloque_id)
                        if 'error' in bloque_data:
                            print(f"  ⚠ get_bloque returned error: {bloque_data['error']}")
                        else:
                            versiones = bloque_data.get('versiones', [])
                            print(f"  ✓ get_bloque succeeded")
                            print(f"    Found {len(versiones)} versiones")
                            
                            if versiones:
                                print(f"\n    Version details:")
                                for i, version in enumerate(versiones[:3]):
                                    print(f"      {i+1}. Modificadora: {version.get('id_norma_modificadora', 'N/A')}")
                                    print(f"         Vigencia desde: {version.get('fecha_vigencia_desde', 'N/A')}")
                                    html_preview = version.get('html', '')[:80]
                                    print(f"         HTML preview: {html_preview}...")
                    except Exception as e:
                        print(f"  ⚠ get_bloque failed: {e}")
        except Exception as e:
            print(f"⚠ get_indice failed: {e}")
            print(f"  This is expected if the endpoint doesn't exist yet")
        print()
    
    # Summary
    print("=" * 70)
    print("Summary:")
    print("=" * 70)
    
    if valid_normas >= 5:
        print("✅ SUCCESS: API is working and parser is producing valid results")
        print()
        print("Next steps:")
        print("1. Run the boe_sync_consolidada DAG in Airflow")
        print("2. Check that boe_norma table is populated")
        print("3. Monitor logs for any parsing errors")
        return 0
    elif valid_normas > 0:
        print("⚠ PARTIAL SUCCESS: API is working but some data may be incomplete")
        print(f"  Only {valid_normas} valid normas found")
        return 0
    else:
        print("✗ FAILED: No valid normas could be parsed")
        print()
        print("Please review the API response structure and update the parser")
        return 1


if __name__ == '__main__':
    sys.exit(main())
