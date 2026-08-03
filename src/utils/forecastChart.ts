type ForecastResponse = {
  t0: string;
  history: number[];
  fit: number[];
  forecast: number[];
  conf_int: [number, number][];
  n_lags: number;
  confidence: number;
  model: string;
};

export function buildForecastChartHTML(data: ForecastResponse): string {
  const W = 340;
  const H = 200;
  const padL = 34;
  const padR = 12;
  const padT = 14;
  const padB = 24;

  const hist = data.history ?? [];
  const fc = data.forecast ?? [];
  const ci = data.conf_int ?? [];

  const nHist = hist.length;
  const nFc = fc.length;
  const nTotal = nHist + nFc;
  if (nTotal < 2) return `<div style="font-size:12px">Sin datos suficientes para graficar.</div>`;

  const allVals = [
    ...hist,
    ...fc,
    ...ci.map((c) => c[0]),
    ...ci.map((c) => c[1]),
  ].filter((v) => typeof v === "number" && !isNaN(v));

  const yMax = Math.max(1, ...allVals) * 1.15;
  const yMin = 0;

  const xAt = (i: number) => padL + (i / (nTotal - 1)) * (W - padL - padR);
  const yAt = (v: number) => {
    const val = typeof v === "number" && !isNaN(v) ? v : 0;
    return padT + (1 - (val - yMin) / (yMax - yMin)) * (H - padT - padB);
  };

  const fcStart = nHist - 1;
  const lastHist = hist[nHist - 1] ?? 0;

  // Línea histórica
  const histPts = hist.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");

  // Línea de pronóstico (arranca en el último histórico)
  const fcPts = [`${xAt(fcStart)},${yAt(lastHist)}`]
    .concat(fc.map((v, i) => `${xAt(nHist + i)},${yAt(v)}`))
    .join(" ");

  // Banda de confianza
  const upper = ci.map((c, i) => `${xAt(nHist + i)},${yAt(c[1])}`);
  const lower = ci.map((c, i) => `${xAt(nHist + i)},${yAt(c[0])}`).reverse();
  const bandPts = [`${xAt(fcStart)},${yAt(lastHist)}`, ...upper, ...lower].join(" ");

  const divX = xAt(fcStart);

  const yTicks = [yMin, yMax / 2, yMax]
    .map((v) => {
      const y = yAt(v);
      return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e8e8e8" stroke-width="1"/>
              <text x="${padL - 5}" y="${y + 3}" font-size="9" text-anchor="end" fill="#999">${v.toFixed(1)}</text>`;
    })
    .join("");

  return `
    <div style="font-family:'Avenir Next W00',sans-serif; width:${W}px;">
      <svg width="${W}" height="${H}" style="background:#fff; display:block;">
        ${yTicks}
        <polygon points="${bandPts}" fill="rgba(215,25,28,0.12)" stroke="none"/>
        <polyline points="${histPts}" fill="none" stroke="#2c7bb6" stroke-width="2.5"/>
        <polyline points="${fcPts}" fill="none" stroke="#d7191c" stroke-width="2.5" stroke-dasharray="5,3"/>
        <line x1="${divX}" y1="${padT}" x2="${divX}" y2="${H - padB}" stroke="#bbb" stroke-width="1" stroke-dasharray="2,2"/>
      </svg>
      <div style="display:flex; gap:14px; font-size:11px; margin-top:4px;">
        <span style="color:#2c7bb6;">■ Histórico</span>
        <span style="color:#d7191c;">■ Pronóstico</span>
        <span style="color:rgba(215,25,28,0.5);">■ Confianza ${data.confidence}%</span>
      </div>
    </div>
  `;
}