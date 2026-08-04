from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from model import model
from agent import ask_agent
from pydantic import BaseModel

app = FastAPI(title="UPS Digital Twin · Forecast Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/forecast")
def forecast(x: float, y: float, horizon: int = 6, confidence: int = 90):
    return model.forecast(x=x, y=y, horizon=horizon, confidence=confidence)

class AgentQuery(BaseModel):
    message: str


@app.post("/agent")
def agent(query: AgentQuery):
    try:
        return ask_agent(query.message)
    except Exception as e:
        return {"type": "error", "text": f"Error consultando el asistente: {e}"}