"""
Airflow hook to notify Router when task status changes
"""
import requests
from typing import Optional
from airflow.hooks.base import BaseHook
from airflow.exceptions import AirflowException


class AgenticRouterStatusHook(BaseHook):
    """Hook to communicate task status changes to the Agentic Router"""
    
    def __init__(self, conn_id: str = "agentic_run_default"):
        super().__init__()
        self.conn_id = conn_id
        self._base_url = None
        self._token = None
        self._setup_connection()
    
    def _setup_connection(self):
        """Setup connection details from Airflow connection"""
        try:
            conn = BaseHook.get_connection(self.conn_id)
            scheme = (conn.conn_type or "http").lower()
            host = conn.host or ""
            port = f":{conn.port}" if conn.port else ""
            base_path = conn.extra_dejson.get("base_path", "") if conn.extra_dejson else ""
            
            self._base_url = f"{scheme}://{host}{port}"
            if base_path:
                self._base_url = f"{self._base_url.rstrip('/')}/{base_path.lstrip('/')}"
            
            self._token = conn.password or (conn.extra_dejson.get("token", "") if conn.extra_dejson else "")
            
            if not self._base_url:
                raise AirflowException(f"Missing base_url/host in connection {self.conn_id}")
                
        except Exception as e:
            raise AirflowException(f"Failed to setup connection {self.conn_id}: {e}")
    
    def notify_status_change(
        self, 
        dag_id: str, 
        task_id: str, 
        run_id: str, 
        status: str,
        job_id: Optional[str] = None,
        reason: Optional[str] = None
    ) -> dict:
        """
        Notify Router about task status change
        
        Args:
            dag_id: DAG identifier
            task_id: Task identifier  
            run_id: Run identifier
            status: New status (FAILED, SUCCEEDED, CANCELLED)
            job_id: Optional job ID for faster lookup
            reason: Optional reason for status change
            
        Returns:
            Response dict from Router API
        """
        payload = {
            "dag_id": dag_id,
            "task_id": task_id, 
            "run_id": run_id,
            "status": status.upper()
        }
        
        if job_id:
            payload["job_id"] = job_id
        if reason:
            payload["reason"] = reason
        
        headers = {}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        
        try:
            response = requests.post(
                f"{self._base_url.rstrip('/')}/jobs/update_status",
                json=payload,
                headers=headers,
                timeout=30
            )
            
            if response.status_code == 200:
                return response.json()
            else:
                raise AirflowException(
                    f"Router status update failed: HTTP {response.status_code} - {response.text[:400]}"
                )
                
        except requests.RequestException as e:
            raise AirflowException(f"Failed to notify Router: {e}")