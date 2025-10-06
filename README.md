
# Agentic Airflow Ecosystem: System Architecture & Quickstart

![System Architecture](architecture.jpg)

This MVP brings up **Airflow 2.10.5** (CeleryExecutor), the **Agent Router**, and one or more **Agent VMs** on a single Docker network. The Airflow plugin and demo DAG are pre-mounted for rapid experimentation.

## 📋 Table of Contents

- [0. Installation & Setup](#0-installation--setup)
- [1. Quickstart (Standard Build)](#1-quickstart-standard-build)
- [2. Health Checks](#2-health-checks)
- [3. Airflow UI & Demo DAG](#3-airflow-ui--demo-dag)
- [4. What You'll See](#4-what-youll-see)
- [5. Clean Build & Cache Management](#5-clean-build--cache-management)
- [6. System Shutdown & Cleanup](#6-system-shutdown--cleanup)
- [7. Router UI](#7-router-ui)
- **[8. Label-Based Job Routing](#8-label-based-job-routing) 🏷️ ← Comprehensive guide with 8+ scenarios**
- [9. Customization](#9-customization)

> **🚀 Quick Start for Advanced Users:** Jump to [Label-Based Job Routing](#8-label-based-job-routing) for intelligent job targeting using environment zones, capabilities, and custom attributes with complete API, UI, and Airflow examples.

## 0. Installation & Setup

### Prerequisites
- **Docker Desktop** (or Docker Engine + Docker Compose)
- **Git**
- **Minimum 8GB RAM** and 20GB free disk space
- **Network access** for downloading Docker images and dependencies

### Clone Repository
```bash
git clone https://github.com/KrishnaChandrasekar/rmc.git agentic-mvp
cd agentic-mvp
git checkout feature/airflowconn
```

## 1. Quickstart (Standard Build)

```bash
cd agentic-mvp
docker compose up --build -d
# Wait ~30s for airflow-init to create the admin user
```


## 2. Health Checks

```bash
curl http://localhost:8000/            # Router root -> 200
curl http://localhost:8000/health      # Router health -> {"ok": true}
curl http://localhost:8001/health      # Agent info
```

> **🏷️ Advanced Job Routing:** For comprehensive examples on using labels to route jobs to specific agents based on environment, capabilities, or custom attributes, see [**Section 8: Label-Based Job Routing**](#8-label-based-job-routing) with detailed scenarios, API examples, and best practices.


## 3. Airflow UI & Demo DAG

- Open [http://localhost:8080](http://localhost:8080)
- Login: `admin` / `admin`
- DAG: `agentic_mvp_demo` (unpause, then trigger)


The connection `agentic_ssh_default` is preconfigured via env:

```
AIRFLOW_CONN_AGENTIC_SSH_DEFAULT='http://:router-secret@router:8000'
```
The plugin uses this to submit jobs to the Router and poll status.


**Note:** The Airflow operator previously named `AgenticSSHOperator` is now called `AgenticRunOperator`. It does not use SSH, but instead runs commands or scripts on the targeted OS via the Agentic Router and Agents. Update your DAGs and plugins to use `AgenticRunOperator` for all job execution tasks.

**Ecosystem Note:** This system supports both Python-based agents and Go-based agents. You can run agents implemented in either language, and they will interoperate seamlessly within the same Agentic Router and Airflow environment.

> **🎯 Advanced Routing:** For intelligent job targeting using labels (environment zones, capabilities, regions), see the complete [Label-Based Job Routing Guide](#8-label-based-job-routing) with Airflow DAG examples.


## 4. What You'll See

- Task `run_on_vm1` runs on the Agent with hostname `vm1.local`, **detached**.
- On the Agent container: job dirs at `/app/agent_jobs/<job_id>/run.log`, `pid`, `rc`.
- Logs available via Router `/logs/<job_id>` with `Authorization: Bearer router-secret`.


## 5. Clean Build & Cache Management

### Complete System Cleanup (Fresh Start)
For troubleshooting or fresh installation, perform these steps in order:

```bash
# 1. Stop and remove all containers
docker-compose down --volumes --remove-orphans

# 2. Clean Docker system (WARNING: Removes ALL unused Docker data)
docker system prune -af --volumes

# 3. Remove specific images (optional - forces rebuild)
docker rmi $(docker images "agentic-mvp*" -q) 2>/dev/null || true

# 4. Clean npm caches
npm cache clean --force
npx clear-npx-cache 2>/dev/null || true

# 5. Clean Vite/Node.js caches (from ui/ directory)
cd ui/
rm -rf node_modules/ .vite/ dist/
cd ..

# 6. Clean browser caches
# Chrome: Ctrl+Shift+Del → "Cached images and files"
# Firefox: Ctrl+Shift+Del → "Cache"
# Safari: Develop → Empty Caches

# 7. Rebuild from scratch
docker-compose up --build
```

### Selective Cleanup Commands

**Docker Only:**
```bash
# Remove containers and volumes
docker-compose down --volumes

# Clean unused Docker data (recovers significant space)
docker system prune -f
```

**Frontend Only:**
```bash
cd ui/
rm -rf node_modules/ .vite/ dist/
npm install
cd ..
docker-compose up --build router-ui
```

**Cache Space Recovery:**
- Docker cleanup typically recovers 10-25GB
- npm cache clean recovers 1-5GB  
- Browser cache clearing recovers 500MB-2GB
- Total potential recovery: 15-30GB+

## 6. System Shutdown & Cleanup

### Graceful Shutdown
```bash
# Stop containers but preserve data
docker-compose down

# Complete removal including volumes
docker-compose down --volumes --remove-orphans
```

### Build Verification & Troubleshooting

#### Port Verification
```bash
# Check if required ports are available
lsof -i :8080,8090,8000,5555 || netstat -an | grep -E ':(8080|8090|8000|5555)'
```

#### Service Health Checks  
```bash
# Router API health
curl -f http://localhost:8000/health || echo "Router not ready"

# Airflow webserver
curl -f http://localhost:8080/health || echo "Airflow not ready" 

# React UI health
curl -f http://localhost:8090 || echo "React UI not ready"
```

#### Container Monitoring
```bash
# View all container status
docker-compose ps

# View service logs
docker-compose logs -f router         # Router API
docker-compose logs -f router-ui      # React UI  
docker-compose logs -f airflow-webserver  # Airflow
docker-compose logs -f agent          # Agent logs

# Monitor resource usage
docker stats --no-stream
```

#### Common Issues & Solutions

**Build/Startup Issues:**
- If Airflow containers fail to install packages, ensure `_PIP_ADDITIONAL_REQUIREMENTS="requests aiohttp"` is present in compose.
- If the DAG stays queued: check `router` and `agent_vm1` logs; ensure Agent publishes `host=vm1.local` and the DAG route labels include that.
- Tokens: Router expects `Authorization: Bearer router-secret`; Agent expects `X-Agent-Token: agent-secret`.

**Port Conflicts:**
```bash
# Kill processes on required ports
sudo lsof -ti:8080,8090,8000,5555 | xargs kill -9 2>/dev/null || true
```

**Memory Issues:**
```bash
# Increase Docker Desktop memory to 8GB+ via Docker Desktop → Settings → Resources
```

**Build Failures:**
```bash
# Nuclear option: complete rebuild
docker-compose down --volumes --remove-orphans
docker system prune -af --volumes
docker-compose up --build --force-recreate
```

#### System Requirements
- **RAM Usage:** 4-6GB during operation
- **Disk Usage:** 15-20GB for images and containers  
- **Network:** All services on `agentic-mvp_default` Docker network
- **CPU:** Multi-core recommended for parallel execution


## 7. Router UI

The system includes a **modern React-based UI** for monitoring jobs and agents:

### React UI - Port 8090
- **URL**: [http://localhost:8090](http://localhost:8090)  
- **Modern React.js implementation** with Vite build system
- Professional design with comprehensive filtering and analytics
- **Service**: `router-ui`

The UI provides:
- **Real-time monitoring** of jobs and agents with auto-refresh
- **Advanced filtering** with time range and timezone support
- **Job submission** and detailed log viewing
- **Analytics dashboard** with interactive charts and metrics
- **Agent management** including registration/deregistration
- **Professional design** with modern typography and responsive layout

## 8. Label-Based Job Routing

> **📚 Complete Guide:** This section provides comprehensive documentation for advanced job routing using labels. Jump to specific topics:
> - [Label System Overview](#label-system-overview) - Core concepts and architecture
> - [Usage Scenarios](#label-usage-scenarios) - 8 detailed examples with curl commands
> - [UI Integration](#using-labels-via-ui) - Step-by-step web interface guide  
> - [Airflow Integration](#airflow-dag-integration) - DAG examples with AgenticRunOperator
> - [Quick Reference](#quick-reference) - Scenario lookup table
> - [Troubleshooting](#troubleshooting-labels) - Debug commands and solutions

The Agentic system provides sophisticated label-based job routing to target specific agents based on their capabilities, environment, or custom attributes.

### Label System Overview

**Agents register with labels** describing their capabilities:
```json
{
  "os": "linux",
  "zone": "production", 
  "gpu": "nvidia-a100",
  "memory": "high",
  "region": "us-west-2"
}
```

**Jobs specify routing labels** to target agents with matching capabilities:
```json
{
  "zone": "production",
  "gpu": "nvidia-a100"
}
```

### Current System Labels

The demo environment provides these pre-configured agent labels:

| Agent | Labels |
|-------|--------|
| `vm1`, `vm2` | `{"os": "linux", "zone": "dev"}` |
| `vm3`, `vm4` | `{"os": "linux", "zone": "qa"}` |  
| `go_vm1`, `go_vm2` | `{"os": "linux", "zone": "go"}` |

### Label Usage Scenarios

#### 1. Environment-Based Routing

**Development Environment Jobs:**
```bash
# Target development zone agents
curl -X POST "http://localhost:8000/submit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer router-secret" \
  -d '{
    "job": {
      "command": "npm test && npm run dev-deploy",
      "name": "Development Deployment"
    },
    "route": {
      "labels": {"zone": "dev"}
    }
  }'
```

**Production Deployment:**
```bash
# Target production environment (requires custom labels)
curl -X POST "http://localhost:8000/submit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer router-secret" \
  -d '{
    "job": {
      "command": "kubectl apply -f production.yaml",
      "name": "Production Deployment"
    },
    "route": {
      "labels": {"zone": "production", "os": "linux"}
    }
  }'
```

#### 2. Technology Stack Routing

**Go Language Jobs:**
```bash
# Target Go-enabled agents
curl -X POST "http://localhost:8000/submit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer router-secret" \
  -d '{
    "job": {
      "command": "go build -o myapp ./cmd && ./myapp --migrate",
      "name": "Go Application Build"
    },
    "route": {
      "labels": {"zone": "go"}
    }
  }'
```

**Python/Data Science Jobs:**
```bash
# Target agents with Python ML capabilities (custom labels)
curl -X POST "http://localhost:8000/submit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer router-secret" \
  -d '{
    "job": {
      "command": "python train_model.py --dataset large --epochs 100",
      "name": "ML Model Training"
    },
    "route": {
      "labels": {"python": "ml", "gpu": "nvidia", "memory": "high"}
    }
  }'
```

#### 3. Resource-Based Routing

**High-Memory Jobs:**
```bash
# Target high-memory agents (requires custom labels)
curl -X POST "http://localhost:8000/submit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer router-secret" \
  -d '{
    "job": {
      "command": "java -Xmx32G -jar data-processor.jar --input huge-dataset.csv",
      "name": "Large Dataset Processing"
    },
    "route": {
      "labels": {"memory": "high", "os": "linux"}
    }
  }'
```

**GPU-Accelerated Jobs:**
```bash
# Target GPU-enabled agents (custom labels)
curl -X POST "http://localhost:8000/submit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer router-secret" \
  -d '{
    "job": {
      "command": "python train_neural_network.py --use-gpu --batch-size 1024",
      "name": "GPU Neural Network Training"
    },
    "route": {
      "labels": {"gpu": "nvidia", "cuda": "11.8"}
    }
  }'
```

#### 4. Geographic/Regional Routing

**Multi-Region Deployment:**
```bash
# US West deployment (custom labels)
curl -X POST "http://localhost:8000/submit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer router-secret" \
  -d '{
    "job": {
      "command": "kubectl --context us-west apply -f service.yaml",
      "name": "US West Deployment"
    },
    "route": {
      "labels": {"region": "us-west", "cloud": "aws"}
    }
  }'

# EU deployment (custom labels)  
curl -X POST "http://localhost:8000/submit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer router-secret" \
  -d '{
    "job": {
      "command": "kubectl --context eu-central apply -f service.yaml",
      "name": "EU Central Deployment"
    },
    "route": {
      "labels": {"region": "eu-central", "cloud": "aws"}
    }
  }'
```

#### 5. Testing & QA Scenarios

**Quality Assurance Testing:**
```bash
# Target QA environment
curl -X POST "http://localhost:8000/submit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer router-secret" \
  -d '{
    "job": {
      "command": "pytest --cov=src tests/ && generate-qa-report.sh",
      "name": "QA Test Suite"
    },
    "route": {
      "labels": {"zone": "qa"}
    }
  }'
```

**Load Testing:**
```bash
# Target performance testing agents (custom labels)
curl -X POST "http://localhost:8000/submit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer router-secret" \
  -d '{
    "job": {
      "command": "k6 run --vus 1000 --duration 10m load-test.js",
      "name": "Load Testing"
    },
    "route": {
      "labels": {"testing": "performance", "bandwidth": "high"}
    }
  }'
```

### Using Labels via UI

1. **Open UI**: Navigate to [http://localhost:8090](http://localhost:8090)
2. **Submit Job**: Click "Submit Job" button
3. **Select Routing**: Choose "(Any agent via labels)" from agent dropdown
4. **Enter Labels**: In the "Labels (JSON)" field, enter:
   ```json
   {"zone": "dev", "os": "linux"}
   ```
5. **Add Command**: Enter your command and click Submit

### Airflow DAG Integration

Use labels in Airflow DAGs with the `AgenticRunOperator`:

```python
from airflow import DAG
from datetime import datetime
from plugins.agentic_ssh import AgenticRunOperator

dag = DAG(
    'label_routing_demo',
    start_date=datetime(2025, 1, 1),
    schedule_interval=None,
    catchup=False
)

# Development environment task
dev_task = AgenticRunOperator(
    task_id='run_on_dev',
    command='echo "Running on development environment"',
    route_labels={'zone': 'dev'},
    dag=dag
)

# QA environment task  
qa_task = AgenticRunOperator(
    task_id='run_on_qa', 
    command='python run_tests.py --environment qa',
    route_labels={'zone': 'qa'},
    dag=dag
)

# Go environment task
go_task = AgenticRunOperator(
    task_id='run_on_go',
    command='go test ./... && go build',
    route_labels={'zone': 'go'},
    dag=dag
)

dev_task >> qa_task >> go_task
```

### Custom Label Setup

To add custom labels to agents, modify their registration:

```bash
# Register agent with custom labels
curl -X POST "http://localhost:8000/agents/register" \
  -H "Content-Type: application/json" \
  -H "X-Agent-Token: agent-secret" \
  -d '{
    "agent_id": "gpu_agent_1",
    "url": "http://gpu-server:8001", 
    "labels": {
      "os": "linux",
      "gpu": "nvidia-a100",
      "cuda": "11.8",
      "memory": "high",
      "zone": "ml-training",
      "region": "us-west-2"
    }
  }'
```

### Label Matching Rules

- **Exact Match Required**: All job labels must exactly match agent labels
- **Subset Matching**: Jobs can specify subset of agent labels
- **Agent Extras OK**: Agents can have additional labels not specified by job
- **Empty Labels**: `{}` matches any available agent
- **No Match**: Job fails with "no suitable agent" error

### Best Practices

1. **Hierarchical Labeling**: Use consistent naming (`zone`, `environment`, `capability`)
2. **Standardized Values**: Use standard values (`dev`/`qa`/`prod`, not `development`/`testing`/`production`)
3. **Capability Labels**: Include technical capabilities (`gpu`, `memory`, `storage`)  
4. **Location Labels**: Add geographic/network location (`region`, `datacenter`)
5. **Fallback Strategy**: Always have agents with minimal labels for general jobs

### Quick Reference

| Scenario | Job Labels | Agent Requirements |
|----------|------------|-------------------|
| Any agent | `{}` | Any active agent |
| Development | `{"zone": "dev"}` | Agent with `zone: "dev"` |
| QA Testing | `{"zone": "qa"}` | Agent with `zone: "qa"` |
| Go Projects | `{"zone": "go"}` | Agent with `zone: "go"` |
| High Memory | `{"memory": "high"}` | Agent with `memory: "high"` |
| GPU Tasks | `{"gpu": "nvidia"}` | Agent with `gpu: "nvidia"` |
| Multi-label | `{"zone": "prod", "gpu": "nvidia"}` | Agent with both labels |

### Troubleshooting Labels

**"No suitable agent" Error:**
```bash
# Check available agents and their labels
curl -s "http://localhost:8000/agents" -H "Authorization: Bearer router-secret" | jq '.agents[] | {agent_id, active, labels}'

# Verify job labels match available agent labels exactly
```

**Job Not Routing as Expected:**
```bash
# Test label matching with simple job
curl -X POST "http://localhost:8000/submit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer router-secret" \
  -d '{
    "job": {"command": "echo \"Testing: $(hostname)\""},
    "route": {"labels": {"zone": "dev"}}
  }'

# Check job assignment
curl -s "http://localhost:8000/jobs?limit=1" -H "Authorization: Bearer router-secret" | jq '.jobs[0] | {job_id, agent_id, labels}'
```

**View Agent Registration:**
```bash
# Check which agents are registered and active
curl -s "http://localhost:8000/agents?active=true" -H "Authorization: Bearer router-secret"
```

## 9. Customization

- Add a second Agent: duplicate the `agent_vm1` block in `docker-compose.yml` with `hostname: vm2.local`, change ports to avoid conflicts, and run a second task with `route_labels={"host":"vm2.local"}`.
- Change Airflow credentials: edit the `airflow-init` command in the compose file.
- UI Development: See `ui-react/README.md` for React UI development and customization.
