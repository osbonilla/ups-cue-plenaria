import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import UniqueValueRenderer from "@arcgis/core/renderers/UniqueValueRenderer";
import { simulatedCrimeConfig } from "../config";

function gaussian(mean: number, stdDev: number): number {
  const u = 1 - Math.random();
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * stdDev;
}

function weightedHour(): number {
  const bucket = Math.random();
  if (bucket < 0.5) return 17 + Math.floor(Math.random() * 7); // 17–23
  if (bucket < 0.75) return Math.floor(Math.random() * 6);     // 0–5
  return 6 + Math.floor(Math.random() * 11);                   // 6–16
}

// Si el punto cae dentro de la huella del edificio, lo empuja al borde más cercano.
function pushOutsideBuilding(x: number, y: number, cx: number, cy: number): { x: number; y: number } {
  const { halfWidth, halfHeight } = simulatedCrimeConfig.buildingFootprint;
  const dx = x - cx;
  const dy = y - cy;
  if (Math.abs(dx) < halfWidth && Math.abs(dy) < halfHeight) {
    // Está dentro: empuja por el eje donde esté más cerca de salir.
    const pushX = halfWidth - Math.abs(dx);
    const pushY = halfHeight - Math.abs(dy);
    const margin = 6 + Math.random() * 20; // separación extra de la fachada
    if (pushX < pushY) {
      return { x: cx + Math.sign(dx || 1) * (halfWidth + margin), y };
    }
    return { x, y: cy + Math.sign(dy || 1) * (halfHeight + margin) };
  }
  return { x, y };
}

export function createSimulatedCrimeLayer(): FeatureLayer {
  const { center, spreadRadius, count, categories } = simulatedCrimeConfig;
  const spatialReference = { wkid: center.spatialReferenceWkid };

  const hotspots = Array.from({ length: 4 }, () => ({
    x: center.x + (Math.random() - 0.5) * spreadRadius * 1.4,
    y: center.y + (Math.random() - 0.5) * spreadRadius * 1.4,
  }));

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const graphics: Graphic[] = [];
  for (let i = 0; i < count; i++) {
    const hotspot = hotspots[Math.floor(Math.random() * hotspots.length)];
    const rawX = gaussian(hotspot.x, spreadRadius * 0.22);
    const rawY = gaussian(hotspot.y, spreadRadius * 0.22);
    const { x, y } = pushOutsideBuilding(rawX, rawY, center.x, center.y);
    const category = categories[Math.floor(Math.random() * categories.length)];

    graphics.push(
      new Graphic({
        geometry: new Point({ x, y, spatialReference }),
        attributes: {
          OBJECTID: i + 1,
          tipo: category.tipo,
          hora: weightedHour(),
          gravedad: 1 + Math.floor(Math.random() * 3),
          fecha: now - Math.floor(Math.random() * 90) * dayMs,
        },
      }),
    );
  }

  const renderer = new UniqueValueRenderer({
    field: "tipo",
    uniqueValueInfos: categories.map((c) => ({
      value: c.tipo,
      symbol: {
        type: "simple-marker",
        style: "circle",
        size: 7,
        color: [...c.color, 0.85],
        outline: { color: [255, 255, 255, 0.6], width: 0.5 },
      } as any,
    })),
  });

  return new FeatureLayer({
    title: simulatedCrimeConfig.title,
    source: graphics,
    objectIdField: "OBJECTID",
    geometryType: "point",
    spatialReference,
    fields: [
      { name: "OBJECTID", type: "oid" },
      { name: "tipo", type: "string" },
      { name: "hora", type: "integer" },
      { name: "gravedad", type: "integer" },
      { name: "fecha", type: "date" },
    ],
    renderer,
    elevationInfo: { mode: "on-the-ground" },
    outFields: ["*"],
    popupTemplate: { title: "{tipo}", content: "Hora: {hora}:00 · Gravedad: {gravedad}" },
    listMode: "hide",
  });
}