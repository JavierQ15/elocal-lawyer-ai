#!/usr/bin/env python3
"""
Test para verificar qué formato devuelve la API del BOE para los bloques.
"""
import requests
import sys

def test_bloque_format():
    """Test qué formato (JSON o XML) devuelve la API del BOE para bloques."""
    
    # Usar un bloque que sabemos que existe del log
    id_norma = "BOE-A-2011-7703"
    id_bloque = "no"
    
    url = f"https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/{id_norma}/texto/bloque/{id_bloque}"
    
    print(f"Testing URL: {url}")
    print("-" * 80)
    
    try:
        # Primero sin especificar Accept header
        print("\n1. Request sin Accept header:")
        response = requests.get(url, timeout=10)
        print(f"   Status Code: {response.status_code}")
        print(f"   Content-Type: {response.headers.get('Content-Type', 'Not specified')}")
        print(f"   Content Length: {len(response.content)} bytes")
        print(f"   First 500 chars:\n{response.text[:500]}")
        
        # Ahora pidiendo JSON explícitamente
        print("\n2. Request con Accept: application/json:")
        response = requests.get(
            url,
            headers={'Accept': 'application/json'},
            timeout=10
        )
        print(f"   Status Code: {response.status_code}")
        print(f"   Content-Type: {response.headers.get('Content-Type', 'Not specified')}")
        print(f"   First 500 chars:\n{response.text[:500]}")
        
        # Ahora pidiendo XML explícitamente
        print("\n3. Request con Accept: application/xml:")
        response = requests.get(
            url,
            headers={'Accept': 'application/xml'},
            timeout=10
        )
        print(f"   Status Code: {response.status_code}")
        print(f"   Content-Type: {response.headers.get('Content-Type', 'Not specified')}")
        print(f"   First 500 chars:\n{response.text[:500]}")
        
    except Exception as e:
        print(f"ERROR: {e}")
        return 1
    
    return 0

if __name__ == "__main__":
    sys.exit(test_bloque_format())
