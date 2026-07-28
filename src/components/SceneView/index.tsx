import React, { useEffect, useRef } from "react";
import { observer } from "mobx-react-lite";
import { mapConfig, assetLayerConfig, orientedImageryConfig } from "../../config";
import SceneLayer from "@arcgis/core/layers/SceneLayer";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import Layer from "@arcgis/core/layers/Layer";
import PortalItem from "@arcgis/core/portal/PortalItem";
import Portal from "@arcgis/core/portal/Portal";
import state from "../../stores/state";
import { getWebSceneIdFromHashParams, setWebSceneIdToHashParams } from "../../utils/URLHashParams";

import "@arcgis/map-components/components/arcgis-scene";
import "@arcgis/map-components/components/arcgis-zoom";
import "@arcgis/map-components/components/arcgis-navigation-toggle";
import "@arcgis/map-components/components/arcgis-compass";
import "@arcgis/map-components/components/arcgis-search";

interface SceneViewProps {
  sceneId?: string;
}

const VISIBLE_LAYER_TITLES = new Set([
  assetLayerConfig.title
]);

const normalizeLayerTitle = (title: string) => title.toLowerCase().replace(/[^a-z0-9]/g, "");
const normalizeUrl = (url: string | undefined | null) =>
  (url ?? "").trim().replace(/\/+$/, "").toLowerCase();

const findConfiguredAssetLayer = (view: any) => {
  const targetItemId = assetLayerConfig.itemId.trim().toLowerCase();
  const targetUrl = normalizeUrl(assetLayerConfig.serviceUrl);
  const targetTitle = assetLayerConfig.title;

  return (
    view?.map?.allLayers
      ?.toArray?.()
      ?.find((layer: any) => {
        const layerItemId = String(layer?.portalItem?.id ?? "").trim().toLowerCase();
        const layerUrl = normalizeUrl(layer?.url);
        return (
          layer?.title === targetTitle ||
          layerUrl === targetUrl ||
          (targetItemId.length > 0 && layerItemId === targetItemId)
        );
      }) ?? null
  );
};

const ensureAssetLayerPresent = async (view: any) => {
  const existingLayer = findConfiguredAssetLayer(view);
  if (existingLayer) {
    existingLayer.visible = false;
    existingLayer.listMode = "show";
    return existingLayer;
  }

  const normalizedBaseUrl = assetLayerConfig.serviceUrl.replace(/\/+$/, "");
  const candidateUrls = [normalizedBaseUrl];
  if (/\/sceneserver$/i.test(normalizedBaseUrl)) {
    candidateUrls.push(`${normalizedBaseUrl}/layers/0`);
  }
  if (/\/featureserver$/i.test(normalizedBaseUrl)) {
    candidateUrls.push(`${normalizedBaseUrl}/0`);
  }

  for (const candidateUrl of candidateUrls) {
    try {
      const nextLayer = /\/featureserver(\/\d+)?$/i.test(candidateUrl)
        ? new FeatureLayer({
            url: candidateUrl,
            title: assetLayerConfig.title,
            listMode: "show",
            visible: false,
          })
        : new SceneLayer({
            url: candidateUrl,
            title: assetLayerConfig.title,
            listMode: "show",
            visible: false,
          });

      await nextLayer.load();
      view?.map?.add?.(nextLayer);
      return nextLayer;
    } catch {
      // Try the next candidate URL.
    }
  }

  return null;
};


// --- Mapillary (Living Atlas, ArcGIS Online) ---
// Agrega a la escena el grupo "Mapillary global street-level imagery":
// cobertura (vector tile) + capa de imágenes orientadas que el panel IMAGERY
// detecta automáticamente (busca type === "oriented-imagery" en allLayers).
// Clave: el PortalItem lleva su propio Portal apuntando a ArcGIS Online,
// porque esriConfig.portalUrl apunta al Enterprise y sin este override el
// ítem se buscaría allí (y fallaría). Arranca invisible: lo enciende el
// toggle IMAGERY (ver SceneToolsHost).
const ensureMapillaryLayerPresent = async (view: any) => {
  const targetItemId = orientedImageryConfig.itemId.trim().toLowerCase();
  const alreadyThere = view?.map?.allLayers
    ?.toArray?.()
    ?.some((layer: any) => {
      const layerItemId = String(layer?.portalItem?.id ?? "").trim().toLowerCase();
      return layerItemId === targetItemId || layer?.title === orientedImageryConfig.title;
    });

  if (alreadyThere) {
    return;
  }

  try {
    const mapillaryLayer = await Layer.fromPortalItem({
      portalItem: new PortalItem({
        id: orientedImageryConfig.itemId,
        portal: new Portal({ url: orientedImageryConfig.portalUrl }),
      }),
    });

    mapillaryLayer.title = orientedImageryConfig.title;
    (mapillaryLayer as any).visible = false;
    (mapillaryLayer as any).listMode = "hide";
    view?.map?.add?.(mapillaryLayer);
    console.log("[Imagery] Capa Mapillary agregada a la escena:", mapillaryLayer.title);
  } catch (error) {
    console.warn("[Imagery] No se pudo cargar Mapillary desde Living Atlas", error);
  }
};

export const SceneView = observer(({ sceneId = "main-scene" }: SceneViewProps) => {
  const websceneId = getWebSceneIdFromHashParams() || mapConfig['web-scene-id'];

  return (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', width: '100%' }}>
    <arcgis-scene
      id={sceneId}
      item-id={websceneId}
      // alpha-compositing-enabled
      // style={{ height: `${state.sceneHeight}px`, width: `${state.sceneWidth}px`, background: "black"}}
      onarcgisViewReadyChange={(event) => {
      const view = event.target.view;
      state.registerView("scene", view);
      state.setViewLoadedById("scene", true);

      const applyLayerListMode = () => {
        const visibleLayerTitles = new Set(
          Array.from(VISIBLE_LAYER_TITLES, normalizeLayerTitle),
        );

        // Keep only specific layers in the LayerList by hiding every other layer item.
        view.map?.allLayers?.forEach((layer: any) => {
          const layerTitle = typeof layer?.title === "string" ? layer.title : "";
          const normalizedTitle = normalizeLayerTitle(layerTitle);
          layer.listMode = visibleLayerTitles.has(normalizedTitle) ? "show" : "hide";
        });
      };

      const initializeAssetLayer = async () => {
        try {
          await ensureAssetLayerPresent(view);
        } catch {
          // If the layer cannot be added, continue with the existing scene layers.
        }

        applyLayerListMode();
      };

      void initializeAssetLayer();
      void ensureMapillaryLayerPresent(view);

      view.popup = {
        dockEnabled: true,
        dockOptions: {
          position: "top-right",
          breakpoint: false,
        },
      };
      
      // Update URL with current webscene ID if not already set
      // if (!getWebSceneIdFromHashParams()) {
      //   setWebSceneIdToHashParams(websceneId);
      // }
    }}
  >
  </arcgis-scene>
  </div>
  );
});