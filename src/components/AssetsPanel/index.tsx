import React, { useEffect, useMemo, useRef, useState } from "react";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import SceneLayer from "@arcgis/core/layers/SceneLayer";
import Graphic from "@arcgis/core/Graphic";
import state from "../../stores/state";
import { assetLayerConfig } from "../../config";

import "@esri/calcite-components/components/calcite-panel";
import "@esri/calcite-components/components/calcite-list";
import "@esri/calcite-components/components/calcite-list-item";
import styles from "./AssetsPanel.module.css";

interface AssetsPanelProps {
  sceneId: string;
  slot?: string;
  activeLevelIds?: string[] | null;
  onVisibleAssetObjectIdsChange?: (objectIds: number[]) => void;
}

interface AssetItem {
  objectId: number;
  fireAsset: string;
  floorLevel: string;
  levelId: string;
  cardinal: string;
  graphic: Graphic;
}

interface AssetGroup {
  group: string;
  legendIconPath: string | null;
  items: AssetItem[];
}

const ASSET_LAYER_URL = assetLayerConfig.serviceUrl;
const ASSET_LAYER_TITLE = assetLayerConfig.title;
const ASSET_LAYER_ITEM_ID = assetLayerConfig.itemId;
const ASSET_LEVEL_FIELD = assetLayerConfig.fields.levelId;
const ASSET_TYPE_FIELD = assetLayerConfig.fields.assetType;
const ASSET_FLOOR_LABEL_FIELD = assetLayerConfig.fields.floorLabel;
const ASSET_CARDINAL_FIELD = assetLayerConfig.fields.cardinal;

const LEGEND_MAP: Record<string, string> = {
  "Fire Depart. Command Cent.": "./assets/icons/fire-dept-command-cent.png",
  "First-Aid": "./assets/icons/first-aid.png",
  "Fire Extinguisher": "./assets/icons/fire-extinguisher.png",
  "Fire Fighter Phone": "./assets/icons/fire-fighter-phone.png",
  "Hydrants": "./assets/icons/hydrant.png",
  "Hose Cabinet": "./assets/icons/hose-cabinet-new.png",
  "Fire Depart./Hose Connect.": "./assets/icons/fire-dept-hose-conne.png",
  "PIV Shut Off": "./assets/icons/piv-shutoff.png"
};

const getLegendIconPath = (fireAsset: string): string | null => {
  const iconPath = LEGEND_MAP[fireAsset];
  if (!iconPath) {
    return null;
  }

  return iconPath;
};

const normalizeUrl = (url: string | undefined | null) => {
  if (!url) {
    return "";
  }

  return url.trim().replace(/\/+$/, "").toLowerCase();
};

const getFieldValue = (
  attributes: Record<string, unknown> | undefined,
  fieldName: string,
): unknown => {
  if (!attributes) {
    return undefined;
  }

  if (fieldName in attributes) {
    return attributes[fieldName];
  }

  const normalizedTarget = fieldName.toLowerCase();
  const matchingEntry = Object.entries(attributes).find(
    ([key]) => key.toLowerCase() === normalizedTarget,
  );

  return matchingEntry?.[1];
};

const getStringFieldValue = (
  attributes: Record<string, unknown> | undefined,
  fieldName: string,
  fallback = "",
) => {
  const value = getFieldValue(attributes, fieldName);
  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value);
};

const findAssetsLayerInView = (view: any) => {
  const targetUrl = normalizeUrl(ASSET_LAYER_URL);
  const targetItemId = ASSET_LAYER_ITEM_ID.trim().toLowerCase();

  return (
    view?.map?.allLayers
      ?.toArray?.()
      ?.find((layer: any) => {
        const layerUrl = normalizeUrl(layer?.url);
        const layerItemId = String(layer?.portalItem?.id ?? "").trim().toLowerCase();
        return layerUrl === targetUrl || (targetItemId.length > 0 && layerItemId === targetItemId);
      }) ?? null
  );
};

export const AssetsPanel: React.FC<AssetsPanelProps> = ({
  sceneId,
  slot = "top-left",
  activeLevelIds = null,
  onVisibleAssetObjectIdsChange,
}) => {
  const highlightHandlesRef = useRef<{ map: any | null; scene: any | null }>({
    map: null,
    scene: null,
  });
  const popupCloseHandlesRef = useRef<{ map: any | null; scene: any | null }>({
    map: null,
    scene: null,
  });
  const syncingPopupCloseRef = useRef(false);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");

  const removePopupCloseWatchers = () => {
    popupCloseHandlesRef.current.map?.remove?.();
    popupCloseHandlesRef.current.scene?.remove?.();
    popupCloseHandlesRef.current.map = null;
    popupCloseHandlesRef.current.scene = null;
  };

  const clearHighlights = () => {
    highlightHandlesRef.current.map?.remove?.();
    highlightHandlesRef.current.scene?.remove?.();
    highlightHandlesRef.current.map = null;
    highlightHandlesRef.current.scene = null;
  };

  const closeViewPopup = async (view: any) => {
    if (!view) {
      return;
    }

    if (typeof view.closePopup === "function") {
      await view.closePopup();
      return;
    }

    if (typeof view.popup?.close === "function") {
      view.popup.close();
    }
  };

  const onPopupClosed = async (sourceViewId: "map" | "scene") => {
    if (syncingPopupCloseRef.current) {
      return;
    }

    syncingPopupCloseRef.current = true;

    try {
      const otherViewId = sourceViewId === "map" ? "scene" : "map";
      const otherView = state.getView(otherViewId);

      await closeViewPopup(otherView);
      clearHighlights();
      setSelectedObjectId(null);
    } finally {
      syncingPopupCloseRef.current = false;
    }
  };

  const watchPopupClose = (view: any, viewId: "map" | "scene") => {
    if (!view) {
      return null;
    }

    if (typeof view.popup?.watch === "function") {
      return view.popup.watch("visible", (visible: boolean) => {
        if (!visible) {
          void onPopupClosed(viewId);
        }
      });
    }

    if (typeof view.watch === "function") {
      return view.watch("popup.visible", (visible: boolean) => {
        if (!visible) {
          void onPopupClosed(viewId);
        }
      });
    }

    return null;
  };

  const syncPopupCloseBetweenViews = () => {
    const mapView = state.getView("map");
    const sceneView = state.getView("scene");

    removePopupCloseWatchers();
    popupCloseHandlesRef.current.map = watchPopupClose(mapView, "map");
    popupCloseHandlesRef.current.scene = watchPopupClose(sceneView, "scene");
  };

  const visibleAssets = useMemo(() => {
    const activeIds =
      activeLevelIds && activeLevelIds.length > 0 ? new Set(activeLevelIds) : null;
    const normalizedSearch = searchText.trim().toLowerCase();

    const matchesSearch = (asset: AssetItem) => {
      if (!normalizedSearch) {
        return true;
      }

      const searchHaystack = [
        asset.fireAsset,
        asset.floorLevel,
        asset.levelId,
        asset.cardinal,
        String(asset.objectId),
      ]
        .join(" ")
        .toLowerCase();

      return searchHaystack.includes(normalizedSearch);
    };

    const assetsMatchingSearch = assets.filter(matchesSearch);

    if (!activeIds) {
      return assetsMatchingSearch;
    }

    const assetsMatchingLevelAndSearch = assetsMatchingSearch.filter((asset) =>
      activeIds.has(asset.levelId),
    );

    if (assetsMatchingLevelAndSearch.length > 0) {
      return assetsMatchingLevelAndSearch;
    }

    // Fallback: keep list visible when level-id lookup and layer schema do not align.
    return assetsMatchingSearch;
  }, [assets, activeLevelIds, searchText]);

  useEffect(() => {
    onVisibleAssetObjectIdsChange?.(visibleAssets.map((asset) => asset.objectId));
  }, [onVisibleAssetObjectIdsChange, visibleAssets]);

  useEffect(() => {
    if (selectedObjectId === null) {
      return;
    }

    const isStillVisible = visibleAssets.some((asset) => asset.objectId === selectedObjectId);
    if (isStillVisible) {
      return;
    }

    setSelectedObjectId(null);
    clearHighlights();
    removePopupCloseWatchers();

    void Promise.all([
      closeViewPopup(state.getView("map")),
      closeViewPopup(state.getView("scene")),
    ]);
  }, [selectedObjectId, visibleAssets]);

  const groupedAssets = useMemo<AssetGroup[]>(() => {
    const grouped = new Map<string, AssetItem[]>();

    for (const asset of visibleAssets) {
      const currentItems = grouped.get(asset.fireAsset) ?? [];
      currentItems.push(asset);
      grouped.set(asset.fireAsset, currentItems);
    }

    return Array.from(grouped.entries())
      .sort(([groupA], [groupB]) => groupA.localeCompare(groupB))
      .map(([group, items]) => ({
        group,
        legendIconPath: getLegendIconPath(group),
        items: [...items].sort((itemA, itemB) => itemA.objectId - itemB.objectId),
      }));
  }, [visibleAssets]);

  useEffect(() => {
    let cancelled = false;

    const loadAssets = async () => {
      setIsLoading(true);
      setLoadError(null);

      try {
        // Get the layer from the active scene view instead of creating a new one
        const sceneView = state.getView("scene");
        let assetsLayer = sceneView ? findAssetsLayerInView(sceneView) : null;

        // Fallback: try map view
        if (!assetsLayer) {
          const mapView = state.getView("map");
          assetsLayer = mapView ? findAssetsLayerInView(mapView) : null;
        }

        // Last resort: create fresh layer
        if (!assetsLayer) {
          try {
            assetsLayer = new FeatureLayer({
              url: ASSET_LAYER_URL,
            });
            await assetsLayer.load();
          } catch {
            assetsLayer = new SceneLayer({
              url: ASSET_LAYER_URL,
            });
            await assetsLayer.load();
          }
        }

        const queryResult = await assetsLayer.queryFeatures({
          where: "1=1",
          outFields: ["*"],
          returnGeometry: true,
          resultRecordCount: 10000,
        });

        if (cancelled) {
          return;
        }

        const objectIdFieldName =
          assetsLayer.objectIdField || assetLayerConfig.fields.objectId;
        const nextAssets: AssetItem[] = [];

        for (const feature of queryResult.features ?? []) {
          const objectId = Number(feature?.attributes?.[objectIdFieldName]);
          if (!Number.isFinite(objectId)) {
            continue;
          }

          nextAssets.push({
            objectId,
            fireAsset: getStringFieldValue(
              feature?.attributes,
              ASSET_TYPE_FIELD,
              "Unknown asset",
            ),
            floorLevel: getStringFieldValue(
              feature?.attributes,
              ASSET_FLOOR_LABEL_FIELD,
              "Unknown floor",
            ),
            levelId: getStringFieldValue(feature?.attributes, ASSET_LEVEL_FIELD, ""),
            cardinal: getStringFieldValue(feature?.attributes, ASSET_CARDINAL_FIELD, ""),
            graphic: feature,
          });
        }

        setAssets(nextAssets);
      } catch {
        if (!cancelled) {
          setLoadError("Unable to load fire assets right now.");
          setAssets([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadAssets();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      clearHighlights();
      removePopupCloseWatchers();
    };
  }, []);

  const handleSelectAsset = async (asset: AssetItem) => {
    setSelectedObjectId(asset.objectId);

    const focusInView = async (viewId: "map" | "scene") => {
      const view = state.getView(viewId);
      if (!view) {
        return;
      }

      const layer = findAssetsLayerInView(view);
      let featureForView = asset.graphic;

      if (layer?.queryFeatures) {
        try {
          const result = await layer.queryFeatures({
            objectIds: [asset.objectId],
            outFields: ["*"],
            returnGeometry: true,
          });

          featureForView = result?.features?.[0] ?? featureForView;
        } catch {
          // Fall back to the preloaded feature if querying by view-layer fails.
        }
      }

      if (layer) {
        try {
          const layerView = await view.whenLayerView(layer);
          highlightHandlesRef.current[viewId]?.remove?.();
          highlightHandlesRef.current[viewId] = layerView.highlight([asset.objectId]);
        } catch {
          // Continue without highlight if the LayerView cannot be resolved.
        }
      }

      try {
        await view.goTo(featureForView, { duration: 900 });
      } catch {
        // Ignore goTo interruptions caused by rapid list interactions.
      }

      try {
        const popupOptions = {
          features: [featureForView],
          location: featureForView.geometry,
        };

        if (typeof view.openPopup === "function") {
          await view.openPopup(popupOptions);
        } else if (typeof view.popup?.open === "function") {
          view.popup.open(popupOptions);
        }
      } catch {
        // Ignore popup failures for non-popup-capable view states.
      }
    };

    await Promise.all([focusInView("map"), focusInView("scene")]);
    syncPopupCloseBetweenViews();
  };

  return (
    <div slot={slot} className={styles.container}>
      <calcite-panel className={styles.panel} heading="Assets">
        <div className={styles.listContainer}>
          {isLoading ? <div className={styles.status}>Loading assets...</div> : null}
          {!isLoading && loadError ? <div className={styles.status}>{loadError}</div> : null}
          {!isLoading && !loadError ? (
            <div className={styles.contentLayout}>
              <div className={styles.searchRow}>
                <input
                  type="search"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  className={styles.searchInput}
                  placeholder="Filter by asset, floor, cardinal, or id"
                  aria-label="Filter fire assets"
                />
              </div>
              {groupedAssets.length > 0 ? (
                <div className={styles.listScrollArea}>
                  <calcite-list
                    label="Fire assets"
                    selection-mode="single"
                    selection-appearance="highlight"
                    display-mode="nested"
                  >
                    {groupedAssets.map((group) => (
                      <calcite-list-item
                        key={group.group}
                        label={group.group}
                        description={`${group.items.length} assets`}
                        expanded
                      >
                        {group.legendIconPath ? (
                          <img
                            slot="content-start"
                            className={styles.groupLegendIcon}
                            src={group.legendIconPath}
                            alt=""
                            aria-hidden="true"
                          />
                        ) : null}
                        {group.items.map((item) => (
                          <calcite-list-item
                            key={item.objectId}
                            label={`ID ${item.objectId}`}
                            description={`${item.fireAsset} - ${item.floorLevel} ${item.cardinal}`}
                            metadata={{
                              fireAsset: item.fireAsset,
                              floorLevel: item.floorLevel,
                              levelId: item.levelId,
                              objectId: item.objectId,
                            }}
                            selected={selectedObjectId === item.objectId}
                            value={item.objectId}
                            onClick={() => {
                              void handleSelectAsset(item);
                            }}
                          ></calcite-list-item>
                        ))}
                      </calcite-list-item>
                    ))}
                  </calcite-list>
                </div>
              ) : (
                <div className={styles.status}>No assets match the current filters.</div>
              )}
            </div>
          ) : null}
        </div>
      </calcite-panel>
    </div>
  );
};
