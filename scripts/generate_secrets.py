#!/usr/bin/env python3
"""
Script to generate required secrets for .env file.
Run this script to generate AIRFLOW_FERNET_KEY and AIRFLOW_SECRET_KEY.
"""

from cryptography.fernet import Fernet
import secrets


def generate_fernet_key():
    """Generate a Fernet key for Airflow."""
    return Fernet.generate_key().decode()


def generate_secret_key(length=32):
    """Generate a random secret key."""
    return secrets.token_hex(length)


def main():
    print("=" * 60)
    print("Generating secrets for BOE RAG System")
    print("=" * 60)
    print()
    
    fernet_key = generate_fernet_key()
    secret_key = generate_secret_key()
    
    print("Add these values to your .env file:")
    print()
    print(f"AIRFLOW_FERNET_KEY={fernet_key}")
    print(f"AIRFLOW_SECRET_KEY={secret_key}")
    print()
    print("=" * 60)
    print()
    print("Complete .env file template:")
    print("=" * 60)
    
    with open('.env.example', 'r') as f:
        content = f.read()
        content = content.replace('your-fernet-key-here', fernet_key)
        content = content.replace('your-secret-key-here', secret_key)
        print(content)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"Error: {e}")
        print()
        print("Make sure you have the required dependencies:")
        print("  pip install cryptography")
