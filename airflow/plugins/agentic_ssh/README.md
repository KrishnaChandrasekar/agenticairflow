# Airflow-Router Status Synchronization

This directory contains the complete implementation for bidirectional status synchronization between Airflow and the Agentic Router system.

## Overview

When an Airflow task is marked as **Failed** by a user or fails due to an error, the system automatically:

1. **Detects the failure** using task callbacks
2. **Looks up the corresponding Router job** using reverse mapping (dag_id, task_id, run_id)
3. **Notifies the agent** to stop the running job via HTTP API
4. **Updates the job status** in Router database to "FAILED"
5. **Records the status change** with timestamps and reasons

## Components

### 1. Status Update Hook (`status_update_hook.py`)
- **Purpose**: HTTP client for communicating with Router API
- **Key Method**: `notify_status_change()` - sends status updates to Router
- **Configuration**: Uses Airflow connections for Router URL and authentication

### 2. Task Callbacks (`status_callbacks.py`)
- **Purpose**: Automatic notification when tasks fail, succeed, or retry
- **Key Functions**:
  - `notify_router_on_failure()` - Called when task fails
  - `notify_router_on_success()` - Called when task succeeds  
  - `notify_router_on_retry()` - Called when task retries
- **Integration**: Automatically added to `AgenticRunOperator` tasks

### 3. Enhanced Operator (`AgenticSSH_operators.py`)
- **Purpose**: Extended `AgenticRunOperator` with automatic Router callbacks
- **New Features**:
  - Stores `agentic_job_id` in XCom for callback access
  - Always enables failure/retry notifications for Airflow-Router integration
  - Automatic status synchronization between Airflow and Router

### 4. Router API Endpoint (`/jobs/update_status`)
- **Purpose**: Receives status updates from Airflow and processes them
- **Process**:
  1. Finds job using `(dag_id, task_id, run_id)` reverse mapping
  2. Updates job status to new state (`FAILED`, `SUCCEEDED`, `CANCELLED`)
  3. If status is terminal (`FAILED`), notifies agent to stop job
  4. Records `finished_at` timestamp and status reason
  5. Returns detailed response about actions taken

## Usage Examples

### Standard Usage (Router Callbacks Always Enabled)
```python
# Router callbacks are always enabled for Airflow-Router integration
task = AgenticRunOperator(
    task_id='my_task',
    command='echo "This will automatically notify Router on failure"',
    agent_id='vm1',
    dag=dag
)
```

### Additional Callback Configuration (Optional)
```python
from agentic_ssh.status_callbacks import notify_router_on_failure

# You can chain additional custom callbacks if needed
def custom_failure_handler(context):
    # Your custom logic here
    pass

task = AgenticRunOperator(
    task_id='my_task',
    command='my_command',
    agent_id='vm1',
    on_failure_callback=custom_failure_handler,  # This chains with Router callbacks
    dag=dag
)
```

## Configuration

### Airflow Connection Setup
Create an Airflow connection with ID `agentic_run_default`:

```
Connection ID: agentic_run_default
Connection Type: HTTP
Host: router-host.example.com
Port: 5000
Password: your_auth_token
Extra: {"base_path": "/api/v1"}
```

### Router Configuration
Ensure the Router has:
- `/jobs/update_status` endpoint enabled
- Authentication configured (if using tokens)
- Agent communication enabled for job termination

## API Flow

### Airflow → Router Status Update
```
POST /jobs/update_status
{
  "dag_id": "my_dag",
  "task_id": "my_task", 
  "run_id": "scheduled__2024-01-01T00:00:00+00:00",
  "status": "FAILED",
  "job_id": "job_123",  // Optional for faster lookup
  "reason": "Task failed: Command returned non-zero exit status 1"
}
```

### Router → Agent Job Termination
```
POST /stop/{job_id}
{
  "force": false,
  "reason": "Airflow task marked as failed"
}
```

## Error Handling

- **Network Failures**: Logged but don't fail the Airflow task
- **Authentication Errors**: Logged with clear error messages
- **Job Not Found**: Returns informative response about lookup attempts
- **Agent Communication Failures**: Logged but status still updated in Router

## Monitoring

### XCom Storage
Each notification stores details in XCom:
- Key: `router_status_notification` - Success details
- Key: `router_notification_error` - Error details
- Key: `agentic_job_id` - Router job ID for reference

### Logging
All components log detailed information:
- Task callback execution
- HTTP request/response details  
- Job lookup and status update results
- Agent notification attempts

## Testing

Use the example DAG `agentic_status_sync_demo.py` to test:
1. Successful task completion
2. Task failure with Router notification
3. Agent-specific routing (Python agents)
4. Go agent routing (graceful degradation)
5. Custom callback chaining

## Troubleshooting

### Common Issues

1. **"Missing base_url/host in connection"**
   - Check Airflow connection configuration
   - Ensure Host field is populated

2. **"Router status update failed: HTTP 401"**
   - Verify authentication token in connection Password field
   - Check Router API authentication configuration

3. **"Job not found with provided identifiers"**
   - Ensure `dag_id`, `task_id`, `run_id` match exactly
   - Check that job was originally submitted through Router

4. **"Agent communication failed"**
   - Verify agent is online and reachable
   - Check agent `/stop/{job_id}` endpoint implementation

### Debug Steps

1. Check Airflow task logs for callback execution
2. Verify XCom values for `agentic_job_id` and notification details
3. Check Router logs for `/jobs/update_status` requests
4. Verify agent logs for job termination requests
5. Check database for job status updates and timestamps