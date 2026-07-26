import React from "react";
import { observer } from "mobx-react-lite";
import { mapConfig, assetLayerConfig } from "../../config";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import state from "../../stores/state";

import "@arcgis/map-components/components/arcgis-map";

interface MapViewProps {
  mapId?: string;
  hidden?: boolean;
}

export const MapView = observer(({ mapId = "main-map", hidden = false }: MapViewProps) => {
  const normalizeUrl = (url: string | undefined | null) =>
    (url ?? "").trim().replace(/\/+$/, "").toLowerCase();

  const findConfiguredAssetLayer = (view: any) => {
    const targetItemId = assetLayerConfig.itemId.trim().toLowerCase();
    const targetUrl = normalizeUrl(assetLayerConfig.serviceUrl);

    return (
      view?.map?.allLayers
        ?.toArray?.()
        ?.find((layer: any) => {
          const layerItemId = String(layer?.portalItem?.id ?? "").trim().toLowerCase();
          const layerUrl = normalizeUrl(layer?.url);
          return layerUrl === targetUrl || (targetItemId.length > 0 && layerItemId === targetItemId);
        }) ?? null
    );
  };

  const ensureAssetLayerPresent = async (view: any) => {
    const existingLayer = findConfiguredAssetLayer(view);
    if (existingLayer) {
      existingLayer.visible = true;
      existingLayer.listMode = "show";
      return existingLayer;
    }

    const normalizedBaseUrl = assetLayerConfig.serviceUrl.replace(/\/+$/, "");
    const candidateUrls = [normalizedBaseUrl];
    if (/\/featureserver$/i.test(normalizedBaseUrl)) {
      candidateUrls.push(`${normalizedBaseUrl}/0`);
    }

    for (const candidateUrl of candidateUrls) {
      try {
        const nextLayer = new FeatureLayer({
          url: candidateUrl,
          title: assetLayerConfig.title,
          visible: true,
          listMode: "show",
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

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        visibility: hidden ? "hidden" : "visible",
        pointerEvents: hidden ? "none" : "auto",
      }}
    >
      <arcgis-map
        id={mapId}
        item-id={mapConfig["web-map-id"]}

        onarcgisViewReadyChange={(event) => {
          const view = event.target.view;
          if (view?.constraints) {
            view.constraints.snapToZoom = false;
          }
          state.registerView("map", view);
          state.setViewLoadedById("map", true);
          view.popup = {
            dockEnabled: true,
            dockOptions: {
              position: "top-right",
              breakpoint: false
            }
          };

          void ensureAssetLayerPresent(view);
        }}
      ></arcgis-map>
    </div>
  );
});
