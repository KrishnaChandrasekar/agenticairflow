# Complete Airflow-Router Status Synchronization Implementation

## Overview

This implementation provides **complete bidirectional status synchronization** between Airflow and the Agentic Router system. When a user marks an Airflow task as **Failed**, the system automatically:

1. ✅ **Detects the failure** using Airflow task callbacks
2. ✅ **Finds the corresponding Router job** using reverse mapping (dag_id, task_id, run_id)  
3. ✅ **Notifies the agent** to terminate the running job
4. ✅ **Updates the Router database** with the new status and timestamp
5. ✅ **Provides comprehensive logging** and error handling

## Architecture Flow

```
Airflow Task Fails
       ↓
Status Callback Triggered
       ↓  
Router API /jobs/update_status
       ↓
Job Lookup via Reverse Mapping
       ↓
Agent API /stop/{job_id}
       ↓
Process Termination (SIGTERM/SIGKILL)
       ↓
Status Update in Router DB
```

## Implementation Components

### 1. **Airflow Plugin Components**

#### A. Status Update Hook (`status_update_hook.py`)
```python
class AgenticRouterStatusHook(BaseHook):
    def notify_status_change(self, dag_id, task_id, run_id, status, job_id=None, reason=None):
        # HTTP client for Router API communication
```

#### B. Task Callbacks (`status_callbacks.py`)
```python
def notify_router_on_failure(context: Context):
    # Automatically called when Airflow task fails
    
class AgenticCallbackMixin:
    # Mixin to add callbacks to operators
```

#### C. Enhanced Operator (`AgenticSSH_operators.py`)
```python
class AgenticRunOperator(AgenticCallbackMixin, BaseOperator):
    def __init__(self, enable_router_callbacks=True, **kwargs):
        # Automatically enables failure/retry notifications
        # Stores job_id in XCom for callback access
```

### 2. **Router API Endpoint** (`app.py`)

#### `/jobs/update_status` Endpoint
```python
@app.route('/jobs/update_status', methods=['POST'])
@token_required
def update_job_status():
    # 1. Receive status update from Airflow
    # 2. Find job using reverse mapping (dag_id, task_id, run_id)
    # 3. Update job status in database
    # 4. If terminal status, notify agent to stop job
    # 5. Return detailed response
```

**Request Format:**
```json
{
  "dag_id": "my_dag",
  "task_id": "my_task", 
  "run_id": "scheduled__2024-01-01T00:00:00+00:00",
  "status": "FAILED",
  "job_id": "job_123",  // Optional for faster lookup
  "reason": "Task failed: Command returned non-zero exit status 1"
}
```

**Response Format:**
```json
{
  "success": true,
  "job_id": "job_123",
  "old_status": "RUNNING",
  "new_status": "FAILED", 
  "agent_notified": true,
  "agent_response": {
    "ok": true,
    "message": "Job terminated successfully",
    "action": "terminated"
  },
  "updated_at": "2024-01-01T12:00:00Z",
  "message": "Job status updated and agent notified"
}
```

### 3. **Agent Job Termination** (`agent/app.py`)

#### `/stop/{job_id}` Endpoint
```python
@app.post("/stop/<job_id>")
def stop_job(job_id: str):
    # 1. Validate job exists and is running
    # 2. Send SIGTERM (or SIGKILL if force=true) to process
    # 3. Create completion files (rc, finished_at)
    # 4. Update job logs with termination reason
    # 5. Return detailed termination status
```

**Request Format:**
```json
{
  "force": false,
  "reason": "Airflow task marked as failed"
}
```

**Response Format:**
```json
{
  "ok": true,
  "message": "Job job_123 terminated successfully",
  "status": "FAILED",
  "rc": 143,
  "action": "terminated",
  "signal": "SIGTERM",
  "reason": "Airflow task marked as failed"
}
```

## Usage Examples

### 1. **Automatic Integration (Recommended)**
```python
# Router callbacks enabled by default
task = AgenticRunOperator(
    task_id='my_task',
    command='long_running_command.sh',
    dag=dag
)
# Automatically notifies Router when task fails/retries
```

### 2. **Manual Callback Configuration**
```python
from agentic_ssh.status_callbacks import notify_router_on_failure

task = AgenticRunOperator(
    task_id='my_task',
    command='my_command',
    on_failure_callback=notify_router_on_failure,
    dag=dag
)
```

### 3. **Disable Callbacks**
```python
task = AgenticRunOperator(
    task_id='my_task',
    command='my_command', 
    enable_router_callbacks=False,  # No automatic notifications
    dag=dag
)
```

## Configuration

### Airflow Connection
Create connection with ID `agentic_run_default`:
```
Connection ID: agentic_run_default
Connection Type: HTTP
Host: router-host.example.com
Port: 5000
Password: your_auth_token
Extra: {"base_path": "/api"}
```

### Environment Variables
```bash
# Router
ROUTER_URL=http://router:8000
AGENT_TOKEN=your-secret-token

# Agent  
AGENT_ID=agent-vm1
SELF_URL=http://agent:8001
AGENT_TOKEN=your-secret-token
```

## Testing the Integration

### 1. **Deploy the System**
```bash
docker-compose up -d
```

### 2. **Submit a Test Job**
```python
# Use the demo DAG
dag = agentic_status_sync_demo.py
```

### 3. **Trigger Failure in Airflow UI**
1. Go to Airflow web UI
2. Find the running task
3. Click "Mark as Failed"
4. Check logs for Router notification

### 4. **Verify Agent Termination**
```bash
# Check agent logs
docker logs agenticairflow-with-dt-agent_vm1-1

# Check Router logs  
docker logs agenticairflow-with-dt-router-1
```

## Monitoring and Debugging

### XCom Storage
Each notification stores audit information:
- `agentic_job_id`: Router job ID for reference
- `router_status_notification`: Success details
- `router_notification_error`: Error details

### Log Locations
- **Airflow Task Logs**: `/opt/airflow/logs/dag_id/task_id/run_id/`
- **Router Logs**: Application logs with API request/response details
- **Agent Logs**: Job termination and process management details

### Common Issues

1. **"Job not found with provided identifiers"**
   - Verify dag_id, task_id, run_id match exactly
   - Check job was originally submitted through Router

2. **"Agent communication failed"**
   - Verify agent is online: `curl http://agent:8001/health`
   - Check network connectivity between Router and Agent

3. **"Router status update failed: HTTP 401"**
   - Verify authentication token in Airflow connection
   - Check Router API token configuration

## Production Considerations

### Security
- Use HTTPS for all API communications
- Rotate authentication tokens regularly
- Implement rate limiting on API endpoints
- Validate all input parameters

### Performance
- Consider connection pooling for high-volume notifications
- Implement retry logic with exponential backoff
- Monitor API response times and success rates

### Reliability
- Use persistent storage for job state
- Implement health checks for all components
- Set up monitoring and alerting for failed notifications
- Consider graceful degradation when components are unavailable

## Summary

This implementation provides a **production-ready solution** for Airflow-Router status synchronization with:

- ✅ **Automatic failure detection** via task callbacks
- ✅ **Robust job lookup** using reverse mapping
- ✅ **Graceful process termination** with SIGTERM/SIGKILL
- ✅ **Comprehensive error handling** and logging
- ✅ **Full audit trail** via XCom and database records
- ✅ **Always-enabled integration** (automatic Router callbacks)
- ✅ **Production-ready monitoring** and debugging tools

The system is designed to be **resilient**, **observable**, and **maintainable** for enterprise deployments.