from datetime import datetime
from sqlalchemy import create_engine, Column, String, Integer, DateTime, JSON
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()

class LocalJob(Base):
    __tablename__ = "local_jobs"
    job_id = Column(String, primary_key=True)
    status = Column(String, default="PENDING")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    pid = Column(Integer, nullable=True)
    rc = Column(Integer, nullable=True)
    log_path = Column(String, nullable=True)
    meta = Column(JSON)

def make_session(db="sqlite:///db.sqlite"):
    eng = create_engine(db, echo=False, future=True)
    Base.metadata.create_all(eng)
    return sessionmaker(bind=eng, expire_on_commit=False)
