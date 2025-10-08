from datetime import datetime
from sqlalchemy import create_engine, Column, String, Integer, DateTime, Text, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()

def now_utc() -> datetime:
    """Return naive UTC datetime for compatibility with existing rows"""
    return datetime.utcnow()

class Job(Base):
    __tablename__ = "jobs"
    job_id     = Column(String, primary_key=True)
    status     = Column(String, default="QUEUED")  # QUEUED | RUNNING | SUCCEEDED | FAILED
    agent_id   = Column(String, nullable=True)
    labels     = Column(Text, nullable=True)       # JSON string
    payload    = Column(Text, nullable=True)       # JSON string (job spec)
    priority   = Column(Integer, default=5)
    rc         = Column(Integer, nullable=True)
    note       = Column(Text, nullable=True)
    log_path   = Column(Text, nullable=True)
    dag_id     = Column(String, nullable=True)      # DAG identifier
    task_id    = Column(String, nullable=True)      # Task identifier
    created_at = Column(DateTime, default=now_utc)
    updated_at = Column(DateTime, default=now_utc, onupdate=now_utc)
    started_at = Column(DateTime, nullable=True)   # When job execution starts
    finished_at = Column(DateTime, nullable=True)  # When job execution completes

class Agent(Base):
    __tablename__ = "agents"
    agent_id   = Column(String, primary_key=True)
    url        = Column(Text, nullable=False)      # e.g. http://agent_vm1:8001
    labels     = Column(Text, nullable=True)       # JSON string
    active     = Column(Boolean, default=True)
    last_heartbeat = Column(DateTime, default=now_utc, onupdate=now_utc)

def make_session(db_url="sqlite:///db.sqlite"):
    eng = create_engine(db_url, echo=False, future=True)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng, expire_on_commit=False)
