# Contributing to BOE Legislation RAG System

Thank you for your interest in contributing to the BOE Legislation RAG System! This document provides guidelines for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/elocal-lawyer-ai.git`
3. Create a branch: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Test your changes
6. Commit: `git commit -m "Description of changes"`
7. Push: `git push origin feature/your-feature-name`
8. Create a Pull Request

## Development Setup

Follow the quickstart guide in the README.md to set up your development environment.

```bash
# Initial setup
make init

# Start services
make up

# View logs
make logs
```

## Code Style

### Python
- Follow PEP 8 guidelines
- Use type hints where appropriate
- Add docstrings to functions and classes
- Keep functions focused and small

### Example:
```python
def process_document(doc_id: str, content: str) -> dict:
    """
    Process a BOE document.
    
    Args:
        doc_id: Unique document identifier
        content: Document text content
        
    Returns:
        Dictionary with processed document data
    """
    # Implementation here
    pass
```

## Testing

Before submitting a PR:

1. Test all affected endpoints
2. Verify Docker containers start successfully
3. Check Airflow DAGs for syntax errors
4. Ensure all services are healthy

```bash
# Run health checks
make test

# Check individual services
make test-api
make test-qdrant
make test-ollama
```

## Areas for Contribution

### High Priority
- **Real BOE API Integration**: Replace placeholder scraper with actual BOE API calls
- **Tests**: Add unit tests and integration tests
- **Error Handling**: Improve error handling across all services
- **Documentation**: Improve inline documentation and user guides

### Medium Priority
- **Performance Optimization**: Optimize embedding generation and search
- **Monitoring**: Add Prometheus/Grafana for monitoring
- **Authentication**: Add API authentication/authorization
- **UI**: Create a web interface for queries

### Low Priority
- **Additional Models**: Support for more embedding models
- **Export Features**: Add export functionality for results
- **Batch Processing**: Add batch query processing
- **API Versioning**: Implement API versioning

## Pull Request Guidelines

### PR Title
Use conventional commit format:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance tasks

Example: `feat: Add authentication to RAG API`

### PR Description
Include:
1. **What**: Brief description of changes
2. **Why**: Motivation for changes
3. **How**: Technical details of implementation
4. **Testing**: How you tested the changes
5. **Screenshots**: If UI changes are involved

### Example PR Description:
```markdown
## What
Adds authentication middleware to the RAG API using JWT tokens.

## Why
The API needs to be secured to prevent unauthorized access in production.

## How
- Implemented JWT token generation and validation
- Added middleware to FastAPI
- Updated endpoints to require authentication
- Added authentication documentation

## Testing
- Tested with valid and invalid tokens
- Verified all endpoints require auth
- Added unit tests for auth functions

## Breaking Changes
All API endpoints now require authentication header.
```

## Code Review Process

1. Submit PR with detailed description
2. Wait for automated checks to pass
3. Address review comments
4. Get approval from maintainer
5. Maintainer will merge

## Commit Messages

Write clear, descriptive commit messages:

```bash
# Good
git commit -m "feat: Add rate limiting to API endpoints"
git commit -m "fix: Correct hash calculation in idempotency check"
git commit -m "docs: Update README with GPU configuration"

# Bad
git commit -m "updates"
git commit -m "fix bug"
git commit -m "changes"
```

## Documentation

When adding features:
1. Update README.md if needed
2. Add docstrings to new functions
3. Update API documentation
4. Add examples if appropriate

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions
- Check existing issues before creating new ones

## License

By contributing, you agree that your contributions will be licensed under the project's license.

## Thank You!

Your contributions help make this project better for everyone! 🎉
