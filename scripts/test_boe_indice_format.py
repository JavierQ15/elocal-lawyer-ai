"""Test script to check if get_indice returns bloques for January 2026 normas."""
import requests
import xml.etree.ElementTree as ET

# Test one of the recently discovered normas
id_norma = "BOE-A-2025-26458"  # First one from the January 2026 discovery

url = f"https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/{id_norma}/texto/indice"

headers = {
    'Accept': 'application/xml'
}

print(f"Testing URL: {url}")
print(f"Headers: {headers}")
print("-" * 80)

response = requests.get(url, headers=headers, timeout=30)

print(f"Status Code: {response.status_code}")
print(f"Content-Type: {response.headers.get('Content-Type')}")
print("-" * 80)
print("First 2000 characters of response:")
print(response.text[:2000])
print("-" * 80)

# Try to parse and see structure
if response.status_code == 200:
    try:
        root = ET.fromstring(response.text)
        print(f"\nRoot tag: {root.tag}")
        
        # Check status
        status_code = root.findtext('.//status/code')
        print(f"Status code in response: {status_code}")
        
        # Look for bloques
        data_elem = root.find('.//data')
        if data_elem is not None:
            # Count children of data
            data_children = list(data_elem)
            print(f"Number of direct children in <data>: {len(data_children)}")
            
            # Check for bloque elements
            bloques = data_elem.findall('.//bloque')
            print(f"Number of <bloque> elements found: {len(bloques)}")
            
            if len(bloques) > 0:
                print("\nFirst bloque structure:")
                first_bloque = bloques[0]
                for child in first_bloque:
                    text = child.text[:100] if child.text else 'NO TEXT'
                    print(f"  - {child.tag}: {text}")
            else:
                print("\nNo <bloque> elements found. Data structure:")
                for i, child in enumerate(data_children[:5]):
                    print(f"  Child {i}: <{child.tag}>")
                    for subchild in list(child)[:5]:
                        text = subchild.text[:50] if subchild.text else 'NO TEXT'
                        print(f"    - {subchild.tag}: {text}")
        else:
            print("No <data> element found!")
    except Exception as e:
        print(f"Error parsing: {e}")
