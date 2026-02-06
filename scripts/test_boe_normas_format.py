"""Test script to see actual BOE API XML response format for list_normas."""
import requests

# Test the list_normas endpoint with January 2026 date range
url = "https://www.boe.es/datosabiertos/api/legislacion-consolidada"
params = {
    'from': '20260101',
    'to': '20260131',
    'limit': 10  # Just get first 10 to see structure
}

headers = {
    'Accept': 'application/xml'
}

print(f"Testing URL: {url}")
print(f"Params: {params}")
print(f"Headers: {headers}")
print("-" * 80)

response = requests.get(url, params=params, headers=headers, timeout=30)

print(f"Status Code: {response.status_code}")
print(f"Content-Type: {response.headers.get('Content-Type')}")
print("-" * 80)
print("First 2000 characters of response:")
print(response.text[:2000])
print("-" * 80)

# Try to parse with ET to see structure
if response.status_code == 200:
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(response.text)
        print(f"\nRoot tag: {root.tag}")
        print(f"Root attribs: {root.attrib}")
        
        # Print first level children
        print("\nFirst level children:")
        for child in root:
            print(f"  - {child.tag}: {child.text[:50] if child.text else 'NO TEXT'}")
            # Print second level
            for subchild in child:
                print(f"    - {subchild.tag}: {subchild.text[:50] if subchild.text else 'NO TEXT'}")
                if subchild.tag == 'data':
                    # Print third level (actual norma elements)
                    for norma in list(subchild)[:2]:  # Just first 2
                        print(f"      - {norma.tag} (first norma):")
                        for field in norma:
                            text = field.text[:100] if field.text else 'NO TEXT'
                            print(f"        - {field.tag}: {text}")
    except Exception as e:
        print(f"Error parsing XML: {e}")
