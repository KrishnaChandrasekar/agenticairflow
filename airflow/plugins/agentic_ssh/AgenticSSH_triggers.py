import asyncio
from airflow.triggers.base import BaseTrigger, TriggerEvent
import aiohttp

class AgenticSSHRouterStatusTrigger(BaseTrigger):
    def __init__(self, router_url: str, token: str, job_id: str, poll_seconds: int = 5):
        super().__init__()
        self.router_url = router_url.rstrip("/")
        self.token = token
        self.job_id = job_id
        self.poll_seconds = poll_seconds

    def serialize(self):
        return (
            "agentic_ssh.AgenticSSH_triggers.AgenticSSHRouterStatusTrigger",
            {"router_url": self.router_url, "token": self.token, "job_id": self.job_id, "poll_seconds": self.poll_seconds},
        )

    async def run(self):
        headers = {"Authorization": f"Bearer {self.token}"}
        url = f"{self.router_url}/status/{self.job_id}"
        while True:
            try:
                async with aiohttp.ClientSession() as sess:
                    async with sess.get(url, headers=headers, timeout=30) as r:
                        if r.status == 200:
                            data = await r.json()
                            st = data.get("status")
                            if st in ["SUCCEEDED", "FAILED"]:
                                yield TriggerEvent({
                                    "final": True,
                                    "status": st,
                                    "rc": data.get("rc"),
                                    "log_path": data.get("log_path"),
                                })
                                return
            except Exception:
                pass
            await asyncio.sleep(self.poll_seconds)
