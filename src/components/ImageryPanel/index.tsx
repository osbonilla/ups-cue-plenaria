import React, { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { Viewer } from "mapillary-js";
import "mapillary-js/dist/mapillary.css";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import state from "../../stores/state";
import * as appConfig from "../../config";
import styles from "./ImageryPanel.module.css";

import "@esri/calcite-components/components/calcite-panel";

// ============================================================================
// Panel IMAGERY — visor oficial de Mapillary (MapillaryJS) embebido.
// La beta de Living Atlas se queda solo como capa de COBERTURA (guía verde en
// la escena); la imagen se resuelve directo contra Mapillary: clic en la
// escena → Graph API busca la imagen más cercana → viewer.moveTo(id).
// Requiere un Client Token gratuito de Mapillary en config.ts:
//   export const mapillaryConfig = { accessToken: "MLY|...|..." };
// (se lee de forma defensiva: la app compila y avisa aunque falte)
// ============================================================================
const MAPILLARY_TOKEN = String(
  (appConfig as any).mapillaryConfig?.accessToken ?? "",
).trim();

type PanelStatus =
  | "sin-token"
  | "listo"
  | "buscando"
  | "mostrando"
  | "sin-imagenes"
  | "error";

const STATUS_TEXT: Record<PanelStatus, string | null> = {
  "sin-token":
    "Falta el token de Mapillary: agrega mapillaryConfig.accessToken en config.ts (gratuito en mapillary.com/dashboard/developers).",
  listo: "Haz clic sobre una calle con cobertura (verde) para cargar la imagen.",
  buscando: "Buscando la imagen más cercana…",
  mostrando: null,
  "sin-imagenes":
    "No hay imágenes de Mapillary cerca de ese punto; intenta sobre las líneas verdes.",
  error: "No se pudo cargar esa imagen; intenta otro punto cercano.",
};

interface ImageryPanelProps {
  sceneId?: string;
}

export const ImageryPanel: React.FC<ImageryPanelProps> = observer(({ sceneId = "main-scene" }) => {
  const sceneView = state.getView("scene");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [status, setStatus] = useState<PanelStatus>(MAPILLARY_TOKEN ? "listo" : "sin-token");
  const [lastClick, setLastClick] = useState<{ lon: number; lat: number } | null>(null);

  // Crear/destruir el visor MapillaryJS (a prueba de StrictMode).
  useEffect(() => {
    if (!MAPILLARY_TOKEN || !containerRef.current) {
      return;
    }

    const viewer = new Viewer({
      accessToken: MAPILLARY_TOKEN,
      container: containerRef.current,
      component: { cover: false },
    });
    viewerRef.current = viewer;

    return () => {
      viewerRef.current = null;
      try {
        viewer.remove();
      } catch {
        // El visor puede estar ya liberado durante el desmontaje.
      }
    };
  }, []);

  // MapillaryJS necesita recalcular su canvas cuando cambia el tamaño del panel.
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        viewerRef.current?.resize();
      } catch {
        // Sin visor activo no hay nada que redimensionar.
      }
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [isExpanded]);

  // Imagen más cercana vía Graph API, con dos radios (~35 m y ~130 m).
  const findNearestImageId = async (lon: number, lat: number) => {
    for (const delta of [0.0003, 0.0012]) {
      try {
        const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
        const url =
          `https://graph.mapillary.com/images?access_token=${encodeURIComponent(MAPILLARY_TOKEN)}` +
          `&fields=id&limit=1&bbox=${bbox}`;
        const response = await fetch(url);
        if (!response.ok) {
          continue;
        }
        const json = await response.json();
        const imageId = json?.data?.[0]?.id;
        if (imageId) {
          return String(imageId);
        }
      } catch {
        // Reintenta con el siguiente radio.
      }
    }

    return null;
  };

  const showNearestImage = async (event: any) => {
    const point = event?.mapPoint;
    if (!point) {
      return;
    }

    let lon = point.longitude;
    let lat = point.latitude;

    if (
      (!Number.isFinite(lon) || !Number.isFinite(lat)) &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y)
    ) {
      const [lng, la] = webMercatorUtils.xyToLngLat(point.x, point.y);
      lon = lng;
      lat = la;
    }

    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return;
    }

    setLastClick({ lon, lat });

    if (!MAPILLARY_TOKEN || !viewerRef.current) {
      return;
    }

    setStatus("buscando");
    const imageId = await findNearestImageId(lon, lat);

    if (!imageId) {
      setStatus("sin-imagenes");
      return;
    }

    try {
      await viewerRef.current.moveTo(imageId);
      setStatus("mostrando");
    } catch (error) {
      console.warn("[Imagery] MapillaryJS no pudo mostrar la imagen", imageId, error);
      setStatus("error");
    }
  };

  // Clic en la escena → cargar imagen (no bloquea otros handlers del clic).
  useEffect(() => {
    if (!sceneView) {
      return;
    }

    const clickHandle = sceneView.on("click", (event: any) => {
      void showNearestImage(event);
    });

    return () => {
      clickHandle?.remove?.();
    };
  }, [sceneView]);

  const statusText = STATUS_TEXT[status];

  return (
    <div className={`${styles.container} ${isExpanded ? styles.expanded : ""}`}>
      <calcite-panel className={styles.panel} heading="Imágenes a nivel de calle">
        <div className={styles.body}>
          <div className={styles.toolbar}>
            <button
              type="button"
              className={styles.expandButton}
              onClick={() => setIsExpanded((current) => !current)}
              aria-pressed={isExpanded}
              aria-label={isExpanded ? "Reducir visor de imágenes" : "Ampliar visor de imágenes"}
            >
              {isExpanded ? "Reducir" : "Ampliar"}
            </button>
          </div>
          <div ref={containerRef} className={styles.orientedImagery}></div>
          {statusText ? <div className={styles.statusLine}>{statusText}</div> : null}
          
        </div>
      </calcite-panel>
    </div>
  );
});