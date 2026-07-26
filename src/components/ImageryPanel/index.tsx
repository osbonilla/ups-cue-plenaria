import React, { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import type OrientedImageryLayer from "@arcgis/core/layers/OrientedImageryLayer";
import state from "../../stores/state";
import styles from "./ImageryPanel.module.css";

import "@esri/calcite-components/components/calcite-panel";
import "@arcgis/map-components/components/arcgis-oriented-imagery-viewer";

interface ImageryPanelProps {
  sceneId?: string;
}

const ORIENTED_IMAGERY_LAYER_TITLE = "Stadium survey images pavco public";

const normalizeTitle = (title: string | undefined | null) =>
  (title ?? "").trim().toLowerCase();

const findOrientedImageryLayer = (view: any): OrientedImageryLayer | null => {
  const layers = view?.map?.allLayers?.toArray?.() ?? [];
  return (
    layers.find(
      (layer: any) =>
        layer?.layerType === "OrientedImageryLayer" ||
        layer?.type === "oriented-imagery" ||
        normalizeTitle(layer?.title) === normalizeTitle(ORIENTED_IMAGERY_LAYER_TITLE),
    ) ?? null
  );
};

export const ImageryPanel: React.FC<ImageryPanelProps> = observer(({ sceneId = "main-scene" }) => {
  const sceneView = state.getView("scene");
  const sceneLoaded = state.viewLoadedById.scene;
  const viewerRef = useRef<HTMLArcgisOrientedImageryViewerElement | null>(null);
  const [layer, setLayer] = useState<OrientedImageryLayer | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (!sceneLoaded || !sceneView) return;

    const updateLayer = () => {
      setLayer(findOrientedImageryLayer(sceneView));
    };

    updateLayer();

    const allLayers = sceneView?.map?.allLayers;
    const handle = allLayers?.on?.("change", updateLayer) ?? null;

    return () => {
      handle?.remove?.();
    };
  }, [sceneLoaded, sceneView]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    (viewer as any).layer = layer ?? null;
  }, [layer]);

  useEffect(() => {
    const viewer = viewerRef.current as any;
    if (!viewer) return;

    const hideTitle = () => {
      const widget = viewer.widget;
      if (widget?.visibleElements) {
        widget.visibleElements.title = false;
      }
    };

    hideTitle();
    viewer.addEventListener?.("arcgisReady", hideTitle);
    return () => {
      viewer.removeEventListener?.("arcgisReady", hideTitle);
    };
  }, []);

  return (
    <div className={`${styles.container} ${isExpanded ? styles.expanded : ""}`}>
      <calcite-panel className={styles.panel} heading="Oriented Imagery">
        <div className={styles.body}>
          <div className={styles.toolbar}>
            <button
              type="button"
              className={styles.expandButton}
              onClick={() => setIsExpanded((current) => !current)}
              aria-pressed={isExpanded}
              aria-label={isExpanded ? "Shrink oriented imagery" : "Expand oriented imagery"}
            >
              {isExpanded ? "Shrink" : "Expand"}
            </button>
          </div>
          <arcgis-oriented-imagery-viewer
            ref={viewerRef}
            reference-element={sceneId}
            className={styles.orientedImagery}
          ></arcgis-oriented-imagery-viewer>
        </div>
      </calcite-panel>
    </div>
  );
});
