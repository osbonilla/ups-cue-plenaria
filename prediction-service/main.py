from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from model import model

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