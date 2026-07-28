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
  name: string;
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
const ASSET_NAME_FIELD = assetLayerConfig.fields.nameField ?? "";
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

// --- Simbología tomada del renderer real del Feature Layer ---
// El servicio publica un Unique Value Renderer sobre category_type con
// símbolos de imagen: extraemos la URL (o data-URI) de cada símbolo para
// usarla como ícono de grupo en el panel. Soporta también el renderer ya
// convertido a point-3d (lo hace SceneToolsHost al activar Pisos) y
// simple-marker (se dibuja un círculo SVG del color del símbolo).
const getSymbolIconUrl = (symbol: any): string | null => {
  if (!symbol) {
    return null;
  }

  if (symbol.type === "picture-marker" && symbol.url) {
    return String(symbol.url);
  }

  if (symbol.type === "point-3d") {
    const symbolLayers = symbol.symbolLayers?.toArray?.() ?? [];
    for (const symbolLayer of symbolLayers) {
      const href = symbolLayer?.resource?.href;
      if (symbolLayer?.type === "icon" && href) {
        return String(href);
      }
    }
  }

  if (symbol.type === "simple-marker") {
    const color = symbol.color ?? {};
    const [r, g, b] = [color.r ?? 128, color.g ?? 128, color.b ?? 128];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="9" fill="rgb(${r},${g},${b})"/></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  return null;
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

// Etiqueta principal: lo DESCRIPTIVO (name_long/use_type) por delante; el
// código de sala ("102", "140") deja de ser título — se muestra pequeño como
// texto secundario. Si un espacio no tiene descriptivo (p. ej. aulas cuyo
// nombre ES el número), se usa su name tal cual.
const getItemDisplayLabel = (item: AssetItem) => {
  const descriptive = [item.floorLevel, item.cardinal]
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(" · ");

  return descriptive || item.name || `ID ${item.objectId}`;
};

const getItemDisplayDescription = (item: AssetItem) => {
  const label = getItemDisplayLabel(item);
  if (item.name && item.name.trim() && item.name !== label) {
    return item.name;
  }

  return "";
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
  const [rendererIconByValue, setRendererIconByValue] = useState<Map<string, string>>(new Map());
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
        asset.name,
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
        legendIconPath: rendererIconByValue.get(group) ?? getLegendIconPath(group),
        items: [...items].sort((itemA, itemB) => itemA.objectId - itemB.objectId),
      }));
  }, [visibleAssets, rendererIconByValue]);

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

        // Ayuda de mapeo: imprime el esquema real para ajustar config.ts.fields
        console.log(
          "[Activos] Capa cargada:",
          assetsLayer?.title ?? assetsLayer?.url,
          "| Campos disponibles:",
          (assetsLayer?.fields ?? []).map((field: any) => field?.name),
        );

        // Simbología: mapa valor de categoría → URL del símbolo del renderer
        try {
          const renderer: any = (assetsLayer as any).renderer;
          const nextIcons = new Map<string, string>();
          if (renderer?.type === "unique-value") {
            for (const info of renderer.uniqueValueInfos ?? []) {
              const iconUrl = getSymbolIconUrl(info?.symbol);
              if (iconUrl && info?.value !== null && info?.value !== undefined) {
                nextIcons.set(String(info.value), iconUrl);
              }
            }
          }
          if (!cancelled) {
            setRendererIconByValue(nextIcons);
          }
        } catch {
          // Sin renderer legible, los grupos quedan sin ícono (no es bloqueante).
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
            name: ASSET_NAME_FIELD
              ? getStringFieldValue(feature?.attributes, ASSET_NAME_FIELD, "")
              : "",
            fireAsset: getStringFieldValue(
              feature?.attributes,
              ASSET_TYPE_FIELD,
              "Sin categoría",
            ),
            floorLevel: getStringFieldValue(
              feature?.attributes,
              ASSET_FLOOR_LABEL_FIELD,
              "",
            ),
            levelId: getStringFieldValue(feature?.attributes, ASSET_LEVEL_FIELD, ""),
            cardinal: getStringFieldValue(feature?.attributes, ASSET_CARDINAL_FIELD, ""),
            graphic: feature,
          });
        }

        setAssets(nextAssets);
      } catch {
        if (!cancelled) {
          setLoadError("No se pudieron cargar los activos en este momento.");
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
      <calcite-panel className={styles.panel} heading="Activos">
        <div className={styles.listContainer}>
          {isLoading ? <div className={styles.status}>Cargando activos…</div> : null}
          {!isLoading && loadError ? <div className={styles.status}>{loadError}</div> : null}
          {!isLoading && !loadError ? (
            <div className={styles.contentLayout}>
              <div className={styles.searchRow}>
                <input
                  type="search"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  className={styles.searchInput}
                  placeholder="Filtrar por tipo, piso, detalle o ID"
                  aria-label="Filtrar activos"
                />
              </div>
              {groupedAssets.length > 0 ? (
                <div className={styles.listScrollArea}>
                  <calcite-list
                    label="Activos"
                    selection-mode="single"
                    selection-appearance="highlight"
                    display-mode="nested"
                  >
                    {groupedAssets.map((group) => (
                      <calcite-list-item
                        key={group.group}
                        label={group.group}
                        description={`${group.items.length} activos`}
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
                            label={getItemDisplayLabel(item)}
                            description={getItemDisplayDescription(item) || undefined}
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
                <div className={styles.status}>Ningún activo coincide con los filtros actuales.</div>
              )}
            </div>
          ) : null}
        </div>
      </calcite-panel>
    </div>
  );
};