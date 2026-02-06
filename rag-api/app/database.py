"""
Database connection utilities.
"""
import os
import psycopg2


def get_db_connection():
    """
    Get a PostgreSQL database connection.
    
    Returns:
        psycopg2 connection object
    """
    return psycopg2.connect(
        host=os.getenv('POSTGRES_HOST', 'postgres'),
        port=os.getenv('POSTGRES_PORT', '5432'),
        user=os.getenv('POSTGRES_USER', 'postgres'),
        password=os.getenv('POSTGRES_PASSWORD', 'postgres'),
        database=os.getenv('POSTGRES_DB', 'boe_legislation')
    )
