import React, { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import WebScene from "@arcgis/core/WebScene";
import EsriSceneView from "@arcgis/core/views/SceneView";
import Portal from "@arcgis/core/portal/Portal";
import navigationState from "../../stores/navigation";
import { secondarySceneConfig } from "../../config";
import styles from "./SecondaryScenePanel.module.css";

import "@esri/calcite-components/components/calcite-panel";

// Pestaña de SOLO VISUALIZACIÓN: muestra una Web Scene alojada en OTRO portal
// (por defecto ArcGIS Online), independiente del Enterprise de la app.
// Clave: el portalItem lleva su propio `portal`, porque esriConfig.portalUrl
// apunta al Enterprise y, sin este override, el ítem se buscaría allí y
// fallaría silenciosamente. La vista se crea al abrir la pestaña y se
// destruye al cerrarla para liberar WebGL.
export const SecondaryScenePanel = observer(() => {
  const isOpen = navigationState.toggles.scene2;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<any | null>(null);
  const viewRef = useRef<any | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [slides, setSlides] = useState<any[]>([]);

  // Cerrar con la "x" del calcite-panel = apagar el toggle.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    const handleClose = () => navigationState.setToggle("scene2", false);
    panel.addEventListener?.("calcitePanelClose", handleClose);
    return () => {
      panel.removeEventListener?.("calcitePanelClose", handleClose);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !containerRef.current) {
      return;
    }

    let cancelled = false;
    setStatus("loading");

    const webscene = new WebScene({
      portalItem: {
        id: secondarySceneConfig.websceneItemId,
        portal: new Portal({ url: secondarySceneConfig.portalUrl }),
      } as any,
    });

    const view = new EsriSceneView({
      container: containerRef.current,
      map: webscene,
    });
    viewRef.current = view;

    view
      .when(() => {
        if (cancelled) {
          return;
        }
        setStatus("ready");
        // Bookmarks de la escena externa: los "slides" autorados en el
        // Scene Viewer viven en webscene.presentation.slides (el SDK no
        // trae widget para esto; se renderizan como tira propia abajo).
        try {
          const slideItems = (webscene as any)?.presentation?.slides?.toArray?.() ?? [];
          setSlides(slideItems);
        } catch {
          setSlides([]);
        }
      })
      .catch((error: any) => {
        console.error("[EscenaExterna] No se pudo cargar la escena", error);
        if (!cancelled) {
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
      viewRef.current = null;
      setSlides([]);
      try {
        view.destroy();
      } catch {
        // La vista puede estar ya destruida durante el desmontaje.
      }
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  // Título configurable: si panelHeading viene vacío ("") no se muestra
  // cabecera en absoluto y el cierre queda en un botón ✕ flotante propio.
  // Nunca se muestran el id del ítem ni la URL del portal.
  const heading = (secondarySceneConfig.panelHeading ?? "").trim();

  return (
    <div className={styles.overlay}>
      <calcite-panel
        ref={panelRef}
        className={styles.panel}
        {...(heading ? { heading, closable: true } : {})}
      >
        <div className={styles.body}>
          {!heading ? (
            <button
              type="button"
              className={styles.closeButton}
              onClick={() => navigationState.setToggle("scene2", false)}
              aria-label="Cerrar escena 3D"
              title="Cerrar"
            >
              ✕
            </button>
          ) : null}
          <div ref={containerRef} className={styles.sceneContainer}></div>
          {status === "loading" ? (
            <div className={styles.status}>Cargando escena…</div>
          ) : null}
          {status === "error" ? (
            <div className={styles.status}>
              No se pudo cargar la escena. Verifica que el ítem sea público y que
              el id/portal en config.ts sean correctos.
            </div>
          ) : null}
          {slides.length > 0 ? (
            <div className={styles.slidesStrip}>
              {slides.map((slide: any, index: number) => (
                <button
                  key={slide?.id ?? index}
                  type="button"
                  className={styles.slideButton}
                  title={slide?.title?.text ?? `Vista ${index + 1}`}
                  onClick={() => {
                    try {
                      slide?.applyTo?.(viewRef.current);
                    } catch {
                      // Slide inválido: se ignora el clic.
                    }
                  }}
                >
                  {slide?.thumbnail?.url ? (
                    <img
                      className={styles.slideThumb}
                      src={slide.thumbnail.url}
                      alt={slide?.title?.text ?? ""}
                    />
                  ) : null}
                  <span className={styles.slideTitle}>
                    {slide?.title?.text ?? `Vista ${index + 1}`}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </calcite-panel>
    </div>
  );
});