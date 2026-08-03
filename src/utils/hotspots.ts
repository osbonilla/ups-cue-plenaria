import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import Graphic from "@arcgis/core/Graphic";
import Polygon from "@arcgis/core/geometry/Polygon";
import SimpleRenderer from "@arcgis/core/renderers/SimpleRenderer";
import { simulatedCrimeConfig } from "../config";

// Vértices de un hexágono "flat-top" centrado en (cx, cy) con radio r.
function hexRing(cx: number, cy: number, r: number): number[][] {
  const ring: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i); // 0,60,...300 → flat-top
    ring.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  ring.push(ring[0]); // cerrar
  return ring;
}

// Agrupa los incidentes en una retícula HEXAGONAL y devuelve columnas 3D
// extruidas por densidad (altura + color ∝ incidentes por hexágono).
export function createHotspotLayer(points: { x: number; y: number }[]): FeatureLayer {
  const { center, spreadRadius } = simulatedCrimeConfig;
  const wkid = center.spatialReferenceWkid;

  const r = 5; // radio del hexágono en metros (≈ tamaño de celda)
  // Geometría de un hex grid flat-top:
  const hStep = r * 1.5;            // separación horizontal entre columnas
  const vStep = r * Math.sqrt(3);   // separación vertical entre filas
  const half = spreadRadius * 1.6;
  const minX = center.x - half;
  const minY = center.y - half;

  // Asigna cada punto al hexágono más cercano (búsqueda en el vecindario).
  const bins = new Map<string, { cx: number; cy: number; count: number }>();

  const hexCenter = (col: number, row: number) => ({
    cx: minX + col * hStep,
    cy: minY + row * vStep + (col % 2 ? vStep / 2 : 0), // columnas impares desplazadas
  });

  for (const p of points) {
    const approxCol = Math.round((p.x - minX) / hStep);
    let best: { col: number; row: number; d2: number } | null = null;
    // Revisa columnas/filas vecinas para hallar el hex más cercano.
    for (let col = approxCol - 1; col <= approxCol + 1; col++) {
      const approxRow = Math.round((p.y - minY - (col % 2 ? vStep / 2 : 0)) / vStep);
      for (let row = approxRow - 1; row <= approxRow + 1; row++) {
        const { cx, cy } = hexCenter(col, row);
        const d2 = (p.x - cx) ** 2 + (p.y - cy) ** 2;
        if (!best || d2 < best.d2) best = { col, row, d2 };
      }
    }
    if (!best) continue;
    const key = `${best.col}:${best.row}`;
    const { cx, cy } = hexCenter(best.col, best.row);
    const b = bins.get(key);
    if (b) b.count += 1;
    else bins.set(key, { cx, cy, count: 1 });
  }

  let maxCount = 1;
  bins.forEach((b) => {
    if (b.count > maxCount) maxCount = b.count;
  });

  const graphics: Graphic[] = [];
  let oid = 1;
  bins.forEach((b) => {
    graphics.push(
      new Graphic({
        geometry: new Polygon({
          rings: [hexRing(b.cx, b.cy, r * 0.95)], // 0.95 → pequeño gap entre hexes
          spatialReference: { wkid },
        }),
        attributes: { OBJECTID: oid++, count: b.count },
      }),
    );
  });

  const renderer = new SimpleRenderer({
    symbol: {
      type: "polygon-3d",
      symbolLayers: [
        {
          type: "extrude",
          material: { color: [255, 255, 255, 0.9] },
          edges: { type: "solid", color: [0, 0, 0, 0.25], size: 0.5 },
        },
      ],
    } as any,
    visualVariables: [
      {
        type: "size",
        field: "count",
        stops: [
          { value: 1, size: 4 },
          { value: maxCount, size: 90 },
        ],
      },
      {
        type: "color",
        field: "count",
        stops: [
          { value: 1, color: "#2c7bb6" },
          { value: Math.max(2, Math.round(maxCount * 0.4)), color: "#ffffbf" },
          { value: maxCount, color: "#d7191c" },
        ],
      },
    ] as any,
  });

  return new FeatureLayer({
    title: "Hotspots (densidad)",
    source: graphics,
    objectIdField: "OBJECTID",
    geometryType: "polygon",
    spatialReference: { wkid },
    fields: [
      { name: "OBJECTID", type: "oid" },
      { name: "count", type: "integer" },
    ],
    renderer,
    elevationInfo: { mode: "on-the-ground" },
    outFields: ["*"],
    popupTemplate: { title: "Zona de riesgo", content: "Incidentes en esta celda: {count}" },
    listMode: "hide",
  });
}