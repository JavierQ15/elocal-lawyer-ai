# Deployment Guide

This guide covers deploying the BOE Legislation RAG System to production environments.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- Linux server (Ubuntu 20.04+ recommended)
- 16GB+ RAM (32GB recommended)
- 100GB+ disk space
- (Optional) NVIDIA GPU with CUDA drivers

## Production Checklist

### Security
- [ ] Change all default passwords in `.env`
- [ ] Generate new Fernet and secret keys
- [ ] Enable HTTPS with reverse proxy
- [ ] Add API authentication
- [ ] Configure firewall rules
- [ ] Set up SSL certificates
- [ ] Enable Docker security features

### Monitoring
- [ ] Set up log aggregation
- [ ] Configure alerting
- [ ] Monitor resource usage
- [ ] Set up health check endpoints
- [ ] Configure backup strategy

### Performance
- [ ] Tune PostgreSQL configuration
- [ ] Configure Qdrant for production
- [ ] Optimize Docker resource limits
- [ ] Set up caching strategy

## Step-by-Step Deployment

### 1. Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Add user to docker group
sudo usermod -aG docker $USER
```

### 2. Clone Repository

```bash
git clone https://github.com/JavierQ15/elocal-lawyer-ai.git
cd elocal-lawyer-ai
```

### 3. Configure Environment

```bash
# Copy example env file
cp .env.example .env

# Generate secrets
python3 scripts/generate_secrets.py

# Edit .env file with production values
nano .env
```

**Important Variables to Change**:
```bash
# PostgreSQL - Change these!
POSTGRES_PASSWORD=<strong-password>

# Airflow - Change these!
AIRFLOW_FERNET_KEY=<generated-key>
AIRFLOW_SECRET_KEY=<generated-key>
AIRFLOW_WWW_USER_PASSWORD=<strong-password>

# Adjust ports if needed
POSTGRES_PORT=5432
QDRANT_PORT=6333
OLLAMA_PORT=11434
AIRFLOW_WEBSERVER_PORT=8080
RAG_API_PORT=8000
```

### 4. Production Docker Compose

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  # Production overrides
  postgres:
    restart: always
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 8G

  qdrant:
    restart: always
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 8G

  ollama:
    restart: always
    deploy:
      resources:
        limits:
          cpus: '8'
          memory: 16G

  airflow-webserver:
    restart: always

  airflow-scheduler:
    restart: always

  rag-api:
    restart: always
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 4G
```

### 5. Set Up Reverse Proxy (Nginx)

Install Nginx:
```bash
sudo apt install nginx -y
```

Configure Nginx (`/etc/nginx/sites-available/boe-rag`):
```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # API endpoint
    location /api/ {
        proxy_pass http://localhost:8000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Airflow UI (protect with authentication)
    location /airflow/ {
        auth_basic "Restricted Access";
        auth_basic_user_file /etc/nginx/.htpasswd;
        
        proxy_pass http://localhost:8080/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/boe-rag /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 6. Set Up SSL with Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d your-domain.com
```

### 7. Start Services

```bash
# Build and start with production config
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Wait for services to be ready
sleep 30

# Pull Ollama models
make pull-models

# Check status
make status
```

### 8. Initialize Database

Database initialization happens automatically via init script.
Verify:
```bash
make shell-postgres
\dt  # List tables
\q   # Exit
```

### 9. Set Up Backups

Create backup script (`/usr/local/bin/backup-boe-db.sh`):
```bash
#!/bin/bash
BACKUP_DIR="/backups/boe-rag"
DATE=$(date +%Y%m%d_%H%M%S)
POSTGRES_CONTAINER="boe-postgres"

mkdir -p $BACKUP_DIR

# Backup PostgreSQL
docker exec -t $POSTGRES_CONTAINER pg_dump -U postgres boe_legislation > "$BACKUP_DIR/postgres_$DATE.sql"

# Backup Qdrant (copy data directory)
docker exec $POSTGRES_CONTAINER tar -czf /tmp/qdrant_backup.tar.gz -C /qdrant/storage .
docker cp boe-qdrant:/tmp/qdrant_backup.tar.gz "$BACKUP_DIR/qdrant_$DATE.tar.gz"

# Keep only last 7 days
find $BACKUP_DIR -type f -mtime +7 -delete

echo "Backup completed: $DATE"
```

Make executable and add to cron:
```bash
sudo chmod +x /usr/local/bin/backup-boe-db.sh

# Add to crontab (daily at 3 AM)
sudo crontab -e
# Add: 0 3 * * * /usr/local/bin/backup-boe-db.sh >> /var/log/boe-backup.log 2>&1
```

### 10. Configure Monitoring

#### System Monitoring with htop
```bash
sudo apt install htop -y
htop
```

#### Docker Stats
```bash
docker stats
```

#### Log Monitoring
```bash
# View all logs
make logs

# Specific service logs
make logs-api
make logs-airflow
```

## Firewall Configuration

```bash
# Allow SSH
sudo ufw allow 22/tcp

# Allow HTTP/HTTPS (if using Nginx)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# If NOT using reverse proxy, open directly:
# sudo ufw allow 8000/tcp  # API
# sudo ufw allow 8080/tcp  # Airflow

# Enable firewall
sudo ufw enable
```

## Maintenance

### Update System

```bash
# Pull latest code
git pull origin main

# Rebuild containers
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build

# Restart services
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Cleanup Old Data

```bash
# Remove old Docker images
docker image prune -a

# Clean Docker system
docker system prune -a --volumes
```

### Monitor Resource Usage

```bash
# Disk space
df -h

# Memory usage
free -h

# Docker volume size
docker system df
```

## Troubleshooting

### Services Won't Start
```bash
# Check logs
docker-compose logs

# Check individual service
docker-compose logs <service-name>

# Restart specific service
docker-compose restart <service-name>
```

### Out of Memory
```bash
# Check memory usage
docker stats

# Adjust resource limits in docker-compose.prod.yml
# Restart services
docker-compose restart
```

### Database Connection Issues
```bash
# Check PostgreSQL logs
make logs-postgres

# Verify connection
docker exec boe-postgres psql -U postgres -d boe_legislation -c "SELECT 1;"
```

## Rollback Procedure

If something goes wrong:

```bash
# Stop services
docker-compose down

# Restore database from backup
docker exec -i boe-postgres psql -U postgres boe_legislation < /backups/boe-rag/postgres_YYYYMMDD_HHMMSS.sql

# Restore Qdrant data
docker cp /backups/boe-rag/qdrant_YYYYMMDD_HHMMSS.tar.gz boe-qdrant:/tmp/
docker exec boe-qdrant tar -xzf /tmp/qdrant_backup.tar.gz -C /qdrant/storage

# Restart services
docker-compose up -d
```

## Performance Tuning

### PostgreSQL
Edit `docker-compose.yml` and add:
```yaml
postgres:
  command: 
    - postgres
    - -c
    - shared_buffers=2GB
    - -c
    - effective_cache_size=6GB
    - -c
    - max_connections=200
```

### Qdrant
Increase memory allocation if needed in docker-compose.prod.yml

### Ollama
Use GPU for better performance. Ensure NVIDIA drivers are installed.

## Support

For issues or questions:
- Check logs: `make logs`
- Review documentation: `/docs`
- Open an issue on GitHub
