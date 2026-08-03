"""
Forecast temporal por ubicación (estilo Forest-based Forecast de ArcGIS Pro).
Al recibir un punto (x,y): construye la serie histórica mensual de incidentes
de ese vecindario, entrena un RandomForest sobre lags y proyecta N pasos con
banda de confianza.
"""
import numpy as np
import pandas as pd
from datetime import datetime
from dateutil.relativedelta import relativedelta
from sklearn.ensemble import RandomForestRegressor

CENTER_X = -8737327.184
CENTER_Y = -23116.927
SPREAD = 450.0
NEIGHBORHOOD = 90.0     # radio (m) alrededor del clic que cuenta como "esta zona"
HISTORY_MONTHS = 36     # meses de histórico simulado
N_LAGS = 6              # ventana de rezagos que usa el modelo
START = datetime(2022, 1, 31)

rng = np.random.default_rng(7)


def _base_incidents():
    """Historial simulado con estacionalidad + tendencia + focos espaciales."""
    hotspots = [
        (CENTER_X + (rng.random() - 0.5) * SPREAD * 1.4,
         CENTER_Y + (rng.random() - 0.5) * SPREAD * 1.4)
        for _ in range(4)
    ]
    rows = []
    for m in range(HISTORY_MONTHS):
        date = START + relativedelta(months=m)
        # Estacionalidad anual + ligera tendencia creciente
        season = 1.0 + 0.5 * np.sin(2 * np.pi * (m % 12) / 12)
        trend = 1.0 + m * 0.015
        for hx, hy in hotspots:
            lam = 3.5 * season * trend
            k = rng.poisson(lam)
            for _ in range(int(k)):
                x = rng.normal(hx, SPREAD * 0.22)
                y = rng.normal(hy, SPREAD * 0.22)
                rows.append((date, x, y))
    return pd.DataFrame(rows, columns=["date", "x", "y"])


class ForecastModel:
    def __init__(self):
        self.df = _base_incidents()
        self.dates = [START + relativedelta(months=m) for m in range(HISTORY_MONTHS)]

    def _series_at(self, x, y):
        """Serie mensual de conteos en el vecindario del punto (x,y)."""
        d = self.df
        mask = ((d.x - x) ** 2 + (d.y - y) ** 2) <= NEIGHBORHOOD ** 2
        near = d[mask]
        counts = []
        for m in range(HISTORY_MONTHS):
            date = self.dates[m]
            c = int((near.date == date).sum())
            counts.append(float(c))
        return np.array(counts)

    def forecast(self, x, y, horizon=6, confidence=90):
        series = self._series_at(x, y)

        # Si la zona casi no tiene datos, añade un piso mínimo para que la curva exista.
        if series.sum() < 3:
            series = series + rng.random(len(series)) * 0.6

        # Construye dataset supervisado con lags
        X, target = [], []
        for i in range(N_LAGS, len(series)):
            X.append(series[i - N_LAGS:i])
            target.append(series[i])
        X = np.array(X)
        target = np.array(target)

        model = RandomForestRegressor(
            n_estimators=100, max_depth=8, random_state=24152, n_jobs=-1
        )
        model.fit(X, target)

        # Valores ajustados (fit) sobre el histórico
        fit = model.predict(X).tolist()

        # Pronóstico recursivo + banda de confianza vía dispersión de árboles
        z = 1.645 if confidence == 90 else 1.96
        window = list(series[-N_LAGS:])
        forecast, conf_int = [], []
        for _ in range(horizon):
            feats = np.array(window[-N_LAGS:]).reshape(1, -1)
            per_tree = np.array([est.predict(feats)[0] for est in model.estimators_])
            mean = float(per_tree.mean())
            std = float(per_tree.std())
            lo = max(0.0, mean - z * std)
            hi = mean + z * std
            forecast.append(round(mean, 4))
            conf_int.append([round(lo, 4), round(hi, 4)])
            window.append(mean)

        return {
            "t0": START.strftime("%Y/%m/%d %H:%M:%S"),
            "unit": "MONTHS",
            "intv": 1,
            "history": [round(float(v), 4) for v in series.tolist()],
            "fit": [round(float(v), 4) for v in fit],
            "forecast": forecast,
            "conf_int": conf_int,
            "n_lags": N_LAGS,
            "confidence": confidence,
            "model": f"Forest-based; number_of_trees:100; time_window:{N_LAGS}; level_of_confidence:{confidence}%",
        }


model = ForecastModel()