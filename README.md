# apsilva-fed-data-platform

Frontend estático para consumir a API do projeto apsilva-bed-data-platform.

Este projeto agora segue o padrão containerizado com simulação de storage local (Azurite).

## Estrutura

- docker-compose.yml
- .env.example
- frontend/index.html
- frontend/Dockerfile
- frontend/nginx.conf
- frontend/assets/styles.css
- frontend/assets/app.js
- frontend/assets/config.js
- azurite-data/

## Parametrização Completa de Ambiente

Este projeto está totalmente parametrizado por variáveis de ambiente em todos os níveis:

### Backend (FastAPI)
- **CORS_ALLOWED_ORIGINS**: Configurável via `.env` (comma-separated origins)
- **Leitura**: `app/config.py` → `app/main.py` middleware

### Frontend (Nginx)
- **FRONTEND_API_BASE_URL**: URL da API (OBRIGATÓRIA)
- **FRONTEND_PORT**: Porta do frontend (OBRIGATÓRIA)
- **Geração dinâmica**: Entrypoint script gera `assets/config.js` at container startup

### Orquestração
- **Script**: `up-data-platform.sh` valida e auto-gera `.env`
- **Validação**: Variables obrigatórias causam erro explícito se não definidas

**Sem localhost hardcoding**: Todas as URLs são parametrizadas via `.env`.

Veja [PARAMETERIZATION_REPORT.md](../PARAMETERIZATION_REPORT.md) para documentação completa.

---

## Configuração Rápida

## Executar local

No diretório do repositório:

```bash
# Copiar arquivo de exemplo (já contém valores por nome de serviço)
cp .env.example .env

# Se necessário, edite .env com URLs customizadas
# Subir services
docker compose up --build -d
```

Abra no navegador:

http://localhost:8080

Endpoints de storage simulada (Azurite):

- Blob: http://localhost:10000 (local)
- Queue: http://localhost:10001 (local)
- Table: http://localhost:10002 (local)

Variáveis obrigatórias no arquivo .env:

- `BACKEND_HOST`: Host da API backend (ex: apsilva-bed-data-platform-api)
- `BACKEND_PORT`: Porta da API backend (ex: 8000)
- `FRONTEND_PORT`: Porta do frontend no host local (ex: 8080)
- `FRONTEND_API_BASE_URL`: URL completa da API consumida pelo frontend (ex: http://apsilva-bed-data-platform.localhost:8000)

Variáveis opcionais no arquivo .env:

- `AZURITE_BLOB_PORT`: Porta Blob storage (padrão: 10000)
- `AZURITE_QUEUE_PORT`: Porta Queue storage (padrão: 10001)
- `AZURITE_TABLE_PORT`: Porta Table storage (padrão: 10002)
- `AZURITE_DATA_DIR`: Caminho local para dados Azurite (padrão: ./azurite-data)
- `PLATFORM_NET_NAME`: Nome da rede Docker (padrão: apsilva-platform-network)

Parar os serviços:

```bash
docker compose down
```

Parar e remover volumes de dados simulados:

```bash
docker compose down -v
```

## Configuração de storage simulada

Connection string padrão para Azurite:

```text
DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFeqCnf2mHB0xKCYk3vL1r8z4H8q11fYjVfR3+3mAfjA==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;
```

## Funcionalidades

- Listar jobs Databricks com limit/offset/expand_tasks
- Disparar job por id
- Disparar job com parâmetros opcionais em JSON
