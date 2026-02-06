"""
Tests for the BOE RAG API.

Run with: pytest tests/
"""
import pytest
import requests
from time import sleep


API_BASE_URL = "http://localhost:8000"


def wait_for_api(max_retries=30, delay=2):
    """Wait for API to be ready."""
    for i in range(max_retries):
        try:
            response = requests.get(f"{API_BASE_URL}/health", timeout=5)
            if response.status_code == 200:
                return True
        except requests.exceptions.RequestException:
            pass
        sleep(delay)
    return False


class TestHealthEndpoint:
    """Tests for health check endpoint."""
    
    def test_health_check(self):
        """Test that health endpoint returns 200."""
        response = requests.get(f"{API_BASE_URL}/health")
        assert response.status_code == 200
        
        data = response.json()
        assert "status" in data
        assert "services" in data
    
    def test_health_services(self):
        """Test that all services are reported in health check."""
        response = requests.get(f"{API_BASE_URL}/health")
        data = response.json()
        
        services = data["services"]
        assert "api" in services
        assert "postgres" in services
        assert "qdrant" in services
        assert "ollama" in services


class TestRootEndpoint:
    """Tests for root endpoint."""
    
    def test_root(self):
        """Test root endpoint returns basic info."""
        response = requests.get(f"{API_BASE_URL}/")
        assert response.status_code == 200
        
        data = response.json()
        assert "message" in data
        assert "docs" in data


class TestDocumentsEndpoint:
    """Tests for documents endpoints."""
    
    def test_list_documents(self):
        """Test listing documents."""
        response = requests.get(f"{API_BASE_URL}/documents")
        assert response.status_code == 200
        
        data = response.json()
        assert "documents" in data
        assert "count" in data
    
    def test_list_documents_pagination(self):
        """Test pagination parameters."""
        response = requests.get(f"{API_BASE_URL}/documents?limit=5&offset=0")
        assert response.status_code == 200
        
        data = response.json()
        assert len(data["documents"]) <= 5
    
    def test_get_document_not_found(self):
        """Test getting non-existent document."""
        response = requests.get(f"{API_BASE_URL}/documents/BOE-INVALID-ID")
        assert response.status_code == 404


class TestStatsEndpoint:
    """Tests for statistics endpoint."""
    
    def test_stats(self):
        """Test statistics endpoint."""
        response = requests.get(f"{API_BASE_URL}/stats")
        assert response.status_code == 200
        
        data = response.json()
        assert "total_documents" in data
        assert "total_chunks" in data
        assert "date_range" in data


class TestQueryEndpoint:
    """Tests for RAG query endpoint."""
    
    def test_query_validation(self):
        """Test query validation."""
        # Missing question
        response = requests.post(f"{API_BASE_URL}/query", json={})
        assert response.status_code == 422
    
    def test_query_max_results_validation(self):
        """Test max_results validation."""
        response = requests.post(
            f"{API_BASE_URL}/query",
            json={"question": "test", "max_results": 100}
        )
        assert response.status_code == 422
    
    def test_query_temperature_validation(self):
        """Test temperature validation."""
        response = requests.post(
            f"{API_BASE_URL}/query",
            json={"question": "test", "temperature": 5.0}
        )
        assert response.status_code == 422


# Placeholder for integration tests
class TestIntegration:
    """Integration tests (require data to be loaded)."""
    
    @pytest.mark.skip(reason="Requires data to be loaded")
    def test_query_with_results(self):
        """Test actual RAG query (requires loaded data)."""
        response = requests.post(
            f"{API_BASE_URL}/query",
            json={
                "question": "¿Qué es el BOE?",
                "max_results": 3
            },
            timeout=60
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert "answer" in data
        assert "sources" in data
        assert "query" in data
        assert len(data["sources"]) <= 3


if __name__ == "__main__":
    # Wait for API to be ready
    print("Waiting for API to be ready...")
    if wait_for_api():
        print("API is ready! Running tests...")
        pytest.main([__file__, "-v"])
    else:
        print("API not ready after waiting. Please start the services first.")
