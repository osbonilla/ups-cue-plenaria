import React, { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import Graphic from "@arcgis/core/Graphic";
import Point from "@arcgis/core/geometry/Point";
import Polyline from "@arcgis/core/geometry/Polyline";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";
import * as geodesicBufferOperator from "@arcgis/core/geometry/operators/geodesicBufferOperator";
import * as geodeticLengthOperator from "@arcgis/core/geometry/operators/geodeticLengthOperator";
import * as promiseUtils from "@arcgis/core/core/promiseUtils";
import state from "../../stores/state";
import { simulatedCrimeConfig, predictionConfig } from "../../config";
import { createSimulatedCrimeLayer } from "../../utils/simulatedCrime";
import { createHotspotLayer } from "../../utils/hotspots";
import { buildForecastChartHTML } from "../../utils/forecastChart";
import styles from "./SecurityPanel.module.css";

import "@esri/calcite-components/components/calcite-panel";

interface SecurityPanelProps {
  sceneId?: string;
}

type TipoStat = { tipo: string; count: number; color: [number, number, number] };
type Stats = { total: number; byTipo: TipoStat[]; peakHour: number | null };
type ForecastState =
  | null
  | { loading: true }
  | { loading: false; error: true }
  | { loading: false; data: any };

export const SecurityPanel: React.FC<SecurityPanelProps> = observer(({ sceneId = "main-scene" }) => {
  const sceneView = state.getView("scene");

  const crimeLayerRef = useRef<any>(null);
  const handleLayerRef = useRef<GraphicsLayer | null>(null); // borde (SketchVM) + centro (arrastre manual)
  const bufferLayerRef = useRef<GraphicsLayer | null>(null); // buffer + etiqueta
  const svmRef = useRef<SketchViewModel | null>(null);
  const centerGraphicRef = useRef<Graphic | null>(null);
  const edgeGraphicRef = useRef<Graphic | null>(null);
  const dragHandleRef = useRef<any>(null);
  const draggingCenterRef = useRef(false);
  const hotspotLayerRef = useRef<any>(null);
  const forecastClickRef = useRef<any>(null);

  const [showHotspots, setShowHotspots] = useState(false);
  const [forecastMode, setForecastMode] = useState(false);
  const [ready, setReady] = useState(false);
  const [radius, setRadius] = useState(simulatedCrimeConfig.defaultBufferRadius);
  const [stats, setStats] = useState<Stats | null>(null);
  const [forecastData, setForecastData] = useState<ForecastState>(null);

  const colorByTipo = new Map(simulatedCrimeConfig.categories.map((c) => [c.tipo, c.color]));

  // --- Consulta espacial + agregación dentro del buffer (debounced) ---
  const runQuery = useRef(
    promiseUtils.debounce(async (buffer: any) => {
      const view = state.getView("scene");
      const crimeLayer = crimeLayerRef.current;
      if (!view || !crimeLayer || !buffer) return;

      const layerView = await view.whenLayerView(crimeLayer);

      const qTipo = crimeLayer.createQuery();
      qTipo.geometry = buffer;
      qTipo.spatialRelationship = "intersects";
      qTipo.outStatistics = [
        { statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "count" },
      ];
      qTipo.groupByFieldsForStatistics = ["tipo"];

      const qHora = crimeLayer.createQuery();
      qHora.geometry = buffer;
      qHora.spatialRelationship = "intersects";
      qHora.outStatistics = [
        { statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "count" },
      ];
      qHora.groupByFieldsForStatistics = ["hora"];

      const [resTipo, resHora] = await Promise.all([
        layerView.queryFeatures(qTipo),
        layerView.queryFeatures(qHora),
      ]);

      const byTipo: TipoStat[] = resTipo.features
        .map((f: any) => ({
          tipo: f.attributes.tipo as string,
          count: f.attributes.count as number,
          color: (colorByTipo.get(f.attributes.tipo) ?? [120, 120, 120]) as [number, number, number],
        }))
        .sort((a: TipoStat, b: TipoStat) => b.count - a.count);

      const total = byTipo.reduce((sum, t) => sum + t.count, 0);

      let peakHour: number | null = null;
      let peakCount = -1;
      for (const f of resHora.features as any[]) {
        if (f.attributes.count > peakCount) {
          peakCount = f.attributes.count;
          peakHour = f.attributes.hora;
        }
      }
      setStats({ total, byTipo, peakHour: total > 0 ? peakHour : null });
    }),
  ).current;

  // --- Setup: capas + zona de análisis arrastrable ---
  useEffect(() => {
    if (!sceneView) return;
    let disposed = false;

    const setup = async () => {
      await geodesicBufferOperator.load();
      await geodeticLengthOperator.load();
      if (disposed) return;

      const sr = sceneView.spatialReference;

      let crimeLayer = crimeLayerRef.current;
      if (!crimeLayer) {
        crimeLayer = createSimulatedCrimeLayer();
        crimeLayerRef.current = crimeLayer;
        sceneView.map?.add(crimeLayer);
      }

      let handleLayer = handleLayerRef.current;
      if (!handleLayer) {
        handleLayer = new GraphicsLayer({ listMode: "hide", elevationInfo: { mode: "on-the-ground" } });
        handleLayerRef.current = handleLayer;
        sceneView.map?.add(handleLayer);
      }
      let bufferLayer = bufferLayerRef.current;
      if (!bufferLayer) {
        bufferLayer = new GraphicsLayer({ listMode: "hide", elevationInfo: { mode: "on-the-ground" } });
        bufferLayerRef.current = bufferLayer;
        sceneView.map?.add(bufferLayer);
      }

      const c = simulatedCrimeConfig.center;
      const centerPt = new Point({ x: c.x, y: c.y, spatialReference: sr });
      const edgePt = new Point({ x: c.x + simulatedCrimeConfig.defaultBufferRadius, y: c.y, spatialReference: sr });

      // Centro: 3D elevado, magenta, claramente agarrable.
      const centerSymbol = {
        type: "point-3d",
        symbolLayers: [
          {
            type: "icon",
            resource: { primitive: "circle" },
            material: { color: [255, 0, 122, 1] },
            outline: { color: [255, 255, 255, 1], size: 2 },
            size: 18,
          },
        ],
        verticalOffset: { screenLength: 24, maxWorldLength: 200 },
        callout: { type: "line", size: 1.5, color: [255, 0, 122, 1] },
      } as any;

      // Borde: cian, lo mueve el SketchViewModel.
      const edgeSymbol = {
        type: "simple-marker",
        style: "circle",
        size: 10,
        color: [0, 200, 255, 1],
        outline: { color: [255, 255, 255, 1], width: 1.5 },
      } as any;

      const centerGraphic = new Graphic({ geometry: centerPt, symbol: centerSymbol, attributes: { role: "center" } });
      const edgeGraphic = new Graphic({ geometry: edgePt, symbol: edgeSymbol, attributes: { role: "edge" } });
      centerGraphicRef.current = centerGraphic;
      edgeGraphicRef.current = edgeGraphic;
      handleLayer.addMany([centerGraphic, edgeGraphic]);

      const computeRadius = (center: Point, edge: Point) => {
        const line = new Polyline({
          paths: [[[center.x, center.y], [edge.x, edge.y]]],
          spatialReference: sr,
        });
        return geodeticLengthOperator.execute(line, { unit: "meters" }) as number;
      };

      const redraw = () => {
        const center = centerGraphicRef.current!.geometry as Point;
        const edge = edgeGraphicRef.current!.geometry as Point;
        const r = computeRadius(center, edge);
        const buffer = geodesicBufferOperator.execute(center, r, { unit: "meters" });

        bufferLayer!.removeAll();
        bufferLayer!.addMany([
          new Graphic({
            geometry: buffer,
            symbol: {
              type: "simple-fill",
              color: [0, 200, 255, 0.18],
              outline: { color: [0, 200, 255, 0.95], width: 2.5 },
            } as any,
          }),
          new Graphic({
            geometry: edge,
            symbol: {
              type: "text",
              color: "#00C8FF",
              haloColor: [0, 0, 0, 0.6],
              haloSize: 1,
              text: `${Math.round(r)} m`,
              xoffset: 12,
              yoffset: 8,
              font: { size: 12, family: "sans-serif" },
            } as any,
          }),
        ]);

        setRadius(Math.round(r));
        runQuery(buffer);
      };

      // --- BORDE: redimensiona (SketchViewModel) ---
      const svm = new SketchViewModel({ view: sceneView, layer: handleLayer });
      svmRef.current = svm;
      svm.on("update", (event: any) => {
        redraw();
        // Mantén SOLO el borde en modo edición (el centro lo movemos aparte).
        if (event.state === "complete") {
          svm.update([edgeGraphicRef.current!], { tool: "move" });
        }
      });

      // --- CENTRO: arrastre manual con hitTest ---
      dragHandleRef.current = sceneView.on("drag", (event: any) => {
        if (event.action === "start") {
          const hit = sceneView.hitTest(event, { include: [handleLayer!] });
          hit.then((res: any) => {
            const grabbedCenter = res.results?.some(
              (r: any) => r.graphic?.attributes?.role === "center",
            );
            if (grabbedCenter) {
              draggingCenterRef.current = true;
              svm.cancel();
            }
          });
          return;
        }

        if (!draggingCenterRef.current) return;

        event.stopPropagation(); // bloquea el paneo mientras movemos el centro

        const mapPoint = sceneView.toMap({ x: event.x, y: event.y });
        if (!mapPoint) return;

        const oldCenter = centerGraphicRef.current!.geometry as Point;
        const oldEdge = edgeGraphicRef.current!.geometry as Point;
        const dx = mapPoint.x - oldCenter.x;
        const dy = mapPoint.y - oldCenter.y;

        centerGraphicRef.current!.geometry = new Point({ x: mapPoint.x, y: mapPoint.y, spatialReference: sr });
        edgeGraphicRef.current!.geometry = new Point({ x: oldEdge.x + dx, y: oldEdge.y + dy, spatialReference: sr });

        redraw();

        if (event.action === "end") {
          draggingCenterRef.current = false;
          svm.update([edgeGraphicRef.current!], { tool: "move" });
        }
      });

      redraw();
      svm.update([edgeGraphic], { tool: "move" });
      setReady(true);
    };

    void setup();

    return () => {
      disposed = true;
      dragHandleRef.current?.remove?.();
      dragHandleRef.current = null;
      forecastClickRef.current?.remove?.();
      forecastClickRef.current = null;
      svmRef.current?.destroy();
      svmRef.current = null;
      if (crimeLayerRef.current) sceneView.map?.remove(crimeLayerRef.current);
      if (handleLayerRef.current) sceneView.map?.remove(handleLayerRef.current);
      if (bufferLayerRef.current) sceneView.map?.remove(bufferLayerRef.current);
      if (hotspotLayerRef.current) sceneView.map?.remove(hotspotLayerRef.current);
      crimeLayerRef.current = null;
      handleLayerRef.current = null;
      bufferLayerRef.current = null;
      hotspotLayerRef.current = null;
      centerGraphicRef.current = null;
      edgeGraphicRef.current = null;
    };
  }, [sceneView]);

  // --- Hotspots 3D (reutiliza los puntos de la capa) ---
  useEffect(() => {
    const view = sceneView;
    const crimeLayer = crimeLayerRef.current;
    if (!view || !crimeLayer || !ready) return;

    if (showHotspots) {
      if (!hotspotLayerRef.current) {
        const points = crimeLayer.source
          .toArray()
          .map((g: any) => ({ x: g.geometry.x, y: g.geometry.y }));
        const layer = createHotspotLayer(points);
        hotspotLayerRef.current = layer;
        view.map?.add(layer);
      }
      crimeLayer.visible = false; // oculta los puntos para ver mejor las columnas
    } else {
      if (hotspotLayerRef.current) {
        view.map?.remove(hotspotLayerRef.current);
        hotspotLayerRef.current = null;
      }
      crimeLayer.visible = true;
    }
  }, [showHotspots, sceneView, ready]);

  // --- Predicción: clic en la escena → /forecast → panel inferior izquierdo ---
  useEffect(() => {
    const view = sceneView;
    if (!view) return;

    if (!forecastMode) {
      forecastClickRef.current?.remove?.();
      forecastClickRef.current = null;
      setForecastData(null);
      return;
    }

    forecastClickRef.current = view.on("click", async (event: any) => {
      const p = event.mapPoint;
      if (!p) return;

      setForecastData({ loading: true });

      try {
        const url = `${predictionConfig.baseUrl}/forecast?x=${p.x}&y=${p.y}&horizon=${predictionConfig.horizon}&confidence=${predictionConfig.confidence}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setForecastData({ loading: false, data });
      } catch (err) {
        setForecastData({ loading: false, error: true });
      }
    });

    return () => {
      forecastClickRef.current?.remove?.();
      forecastClickRef.current = null;
    };
  }, [forecastMode, sceneView]);

  return (
    <div className={styles.container}>
      <calcite-panel className={styles.panel} heading="Seguridad Robos">
        <div className={styles.body}>
          {/* Zona de análisis */}
          <div className={styles.section}>
            <div className={styles.sectionBody}>
              <label className={styles.sliderLabel}>
                Radio de la zona: <strong>{radius} m</strong>
              </label>
              <span className={styles.hint}>
                Arrastra el punto <strong style={{ color: "#ff007a" }}>magenta</strong> (centro) para mover la zona · el punto <strong style={{ color: "#00c8ff" }}>cian</strong> para cambiar el radio.
              </span>
            </div>
          </div>

          {/* Hotspots 3D */}
          <div className={styles.section}>
            <div className={styles.sectionBody}>
              <button
                type="button"
                className={styles.button}
                onClick={() => setShowHotspots((v) => !v)}
                disabled={!ready}
              >
                {showHotspots ? "Ocultar hotspots 3D" : "Mostrar hotspots 3D (densidad)"}
              </button>
              <span className={styles.hint}>
                Columnas 3D por densidad de incidentes: más altas y rojas = más robos.
              </span>
            </div>
          </div>

          {/* Predicción */}
          <div className={styles.section}>
            <div className={styles.sectionBody}>
              <button
                type="button"
                className={styles.button}
                onClick={() => setForecastMode((v) => !v)}
                disabled={!ready}
              >
                {forecastMode ? "Desactivar predicción" : "Activar predicción (clic en el mapa)"}
              </button>
              <span className={styles.hint}>
                {forecastMode
                  ? "Haz clic en cualquier punto de la escena para ver su pronóstico temporal."
                  : "Activa el modo predicción y haz clic en el mapa para pronosticar incidentes futuros."}
              </span>
            </div>
          </div>

          {/* Resultados de la zona */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Resultados de la zona</div>
            <div className={styles.sectionBody}>
              {stats ? (
                stats.total > 0 ? (
                  <>
                    <div className={styles.total}>
                      <span className={styles.totalNumber}>{stats.total}</span>
                      <span className={styles.totalLabel}>incidentes en la zona</span>
                    </div>
                    {stats.peakHour !== null ? (
                      <div className={styles.peak}>
                        Hora más crítica: <strong>{String(stats.peakHour).padStart(2, "0")}:00</strong>
                      </div>
                    ) : null}
                    <div className={styles.bars}>
                      {stats.byTipo.map((t) => {
                        const pct = stats.total > 0 ? (t.count / stats.total) * 100 : 0;
                        return (
                          <div key={t.tipo} className={styles.barRow}>
                            <span className={styles.barLabel}>{t.tipo}</span>
                            <div className={styles.barTrack}>
                              <div
                                className={styles.barFill}
                                style={{
                                  width: `${pct}%`,
                                  background: `rgb(${t.color[0]}, ${t.color[1]}, ${t.color[2]})`,
                                }}
                              />
                            </div>
                            <span className={styles.barValue}>{t.count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <span className={styles.hint}>Sin incidentes dentro de la zona.</span>
                )
              ) : (
                <span className={styles.hint}>Cargando zona…</span>
              )}
            </div>
          </div>
        </div>
      </calcite-panel>

      {/* Panel de pronóstico (fijo abajo-izquierda) */}
      {forecastData ? (
        <div className={styles.forecastPanel}>
          <div className={styles.forecastHeader}>
            <span>Pronóstico temporal (6 meses)</span>
            <button
              type="button"
              className={styles.forecastClose}
              onClick={() => setForecastData(null)}
              aria-label="Cerrar"
            >
              ✕
            </button>
          </div>
          {forecastData.loading ? (
            <span className={styles.hint}>Calculando pronóstico…</span>
          ) : "error" in forecastData ? (
            <span style={{ color: "#d7191c", fontSize: "12px" }}>
              No se pudo conectar con el servicio de predicción ({predictionConfig.baseUrl}).
            </span>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: buildForecastChartHTML(forecastData.data) }} />
          )}
        </div>
      ) : null}
    </div>
  );
});