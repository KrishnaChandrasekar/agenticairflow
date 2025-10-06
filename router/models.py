from datetime import datetime
from sqlalchemy import create_engine, Column, String, Integer, DateTime, JSON, Text, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()

class Job(Base):
    __tablename__ = "jobs"
    job_id = Column(String, primary_key=True)
    status = Column(String, default="QUEUED")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)  # When job execution starts
    finished_at = Column(DateTime, nullable=True)  # When job execution completes
    labels = Column(JSON)
    priority = Column(Integer, default=5)
    payload = Column(JSON)
    agent_id = Column(String, nullable=True)
    rc = Column(Integer, nullable=True)
    log_path = Column(String, nullable=True)
    note = Column(Text, nullable=True)

class Agent(Base):
    __tablename__ = "agents"
    agent_id = Column(String, primary_key=True)
    url = Column(String)
    labels = Column(JSON)
    active = Column(Boolean, default=True)
    last_seen = Column(DateTime, default=datetime.utcnow)

def make_session(db_url="sqlite:///db.sqlite"):
    eng = create_engine(db_url, echo=False, future=True)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng, expire_on_commit=False)
