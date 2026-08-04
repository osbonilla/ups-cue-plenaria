import React, { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import SliceAnalysis from "@arcgis/core/analysis/SliceAnalysis";
import SlicePlane from "@arcgis/core/analysis/SlicePlane";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import Point from "@arcgis/core/geometry/Point";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import { assetLayerConfig, orientedImageryConfig } from "../../config";
import state from "../../stores/state";
import assistantStore from "../../stores/assistant";
import navigationState from "../../stores/navigation";
import { AssetsPanel } from "../AssetsPanel";
import { FloorPicker } from "../FloorPicker";
import { AnalysisPanel } from "../AnalysisPanel";
import { ImageryPanel } from "../ImageryPanel";
import { SecurityPanel } from "../SecurityPanel";
import { BasemapPanel } from "../BasemapPanel";
import { FocusAreaButton } from "../FocusAreaButton";
import styles from "./SceneToolsHost.module.css";
import esriRequest from "@arcgis/core/request";
import { fromJSON } from "@arcgis/core/renderers/support/jsonUtils";
import { toPoint3DIconSymbol } from "../../utils";


interface SceneToolsHostProps {
  sceneId?: string;
}

export const SceneToolsHost = observer(({ sceneId = "main-scene" }: SceneToolsHostProps) => {
  const excludedLayerTitles = ["Places and Labels"];
  const fireAssetsLayerTitle = assetLayerConfig.title;
  const fireAssetsLayerItemId = assetLayerConfig.itemId;
  const objectIdField = assetLayerConfig.fields.objectId;
  const levelLookupUrl = "https://services6.arcgis.com/oQnbmhWcCuy4gMUa/arcgis/rest/services/Vancouver__BCplace_levels/FeatureServer/126";
  const [sectionCenterX, sectionCenterY] = [-8737327.184, -23116.927];

  // --- REFERENCIA VERTICAL LOCAL DE LA ESCENA ---
  // Esta Web Scene es una "Local Scene" con su propio marco vertical, NO la
  // elevación global de Quito (~2791 msnm): nunca usar ground.queryElevation().
  // OJO: el z ≈ 18 medido con view.center es donde el rayo central de la cámara
  // tocó el modelo (probablemente la CUBIERTA, no la base). Se usa solo como
  // respaldo: el rango real zmin/zmax se lee del fullExtent del propio
  // BuildingSceneLayer (ver autocalibración más abajo).
  const buildingBaseZ = 18;
  const sectionCenterZ = buildingBaseZ; // plano vertical de 130 m de alto centrado aquí: cubre el edificio con holgura
  const [buildingZRange, setBuildingZRange] = useState<{ zmin: number; zmax: number } | null>(null);
  // --- fin REFERENCIA VERTICAL ---

  const sectionPlaneWidth = 150;
  const sectionPlaneHeight = 50;
  const sectionPlaneTilt = 90;
  const sceneView = state.getView("scene");
  const mapView = state.getView("map");
  const sliceAnalysisRef = useRef<SliceAnalysis | null>(null);
  const sectionsSliceAnalysisRef = useRef<SliceAnalysis | null>(null);
  const sectionsSliceShapeWatchHandleRef = useRef<any | null>(null);
  const syncingSectionsSliceShapeRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const filteredLayerViewsRef = useRef<Set<any>>(new Set());
  const managedFloorplanLayersRef = useRef<Set<any>>(new Set());
  const initialFloorplanVisibilityByLayerRef = useRef<Map<any, boolean>>(new Map());
  const levelIdsByNumberRef = useRef<Map<number, string[]>>(new Map());
  const levelNumberByIdRef = useRef<Map<string, number>>(new Map());
  const supportsLevelFieldByLayerRef = useRef<Map<any, boolean>>(new Map());
  const [levelLookupReady, setLevelLookupReady] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState(4);
  const [visibleAssetObjectIds, setVisibleAssetObjectIds] = useState<number[] | null>(null);

  // --- PISOS AUTOCALIBRADOS AL RANGO VERTICAL REAL DEL BIM ---
  // El plano horizontal oculta lo que queda ARRIBA del corte: para "ver el
  // piso N" el z debe quedar entre la losa del piso N y su techo. Los cortes
  // se reparten uniformemente entre el zmin y zmax reales del edificio
  // (leídos del fullExtent del BuildingSceneLayer). Nivel 4 ≈ edificio casi
  // completo. Afinado fino opcional: reemplazar por los z reales de cada losa
  // (listener de clic) o derivarlos del layer "Levels" de Indoors en Fase 2.
  const floorLevels = useMemo(() => {
    const zmin = buildingZRange?.zmin ?? buildingBaseZ - 18; // respaldo: base ≈ 0
    const zmax = buildingZRange?.zmax ?? buildingBaseZ;      // respaldo: cubierta ≈ 18
    const span = Math.max(zmax - zmin, 4); // evita rangos degenerados
    return [1, 2, 3, 4].map((level) => ({
      level,
      z: zmin + (span * level) / 4,
    }));
  }, [buildingZRange]);
  // --- fin PISOS ---

  const activeZ = useMemo(
    () => floorLevels.find((item) => item.level === selectedLevel)?.z ?? floorLevels[0].z,
    [floorLevels, selectedLevel],
  );
  const getActiveLevelIds = (currentLevel: number) => {
    return levelIdsByNumberRef.current.get(currentLevel) ?? [];
  };
  const activeLevelIdsForAssets = useMemo(() => {
    if (!navigationState.toggles.floors || !levelLookupReady) {
      return null;
    }

    return getActiveLevelIds(selectedLevel);
  }, [selectedLevel, navigationState.toggles.floors, levelLookupReady]);
  const animatedZRef = useRef(activeZ);

  // --- MODIFICADO: createSlicePlane ahora usa sectionCenterX/Y (Quito) ---
  // Antes: x/y hardcodeados de Vancouver (-13704727.87..., 6321985.86...),
  // completamente fuera de tu campus. Ahora comparte el mismo centro que
  // el plano de Sections, para que ambas herramientas corten en tu edificio.
  const createSlicePlane = (z: number) =>
    new SlicePlane({
      heading: 58, // (antes 51.76°: orientación de BC Place; irrelevante en un plano horizontal)
      tilt: 0,
      width: 135,
      height: 110,
      position: {
        spatialReference: { latestWkid: 3857, wkid: 102100 },
        x: sectionCenterX,
        y: sectionCenterY,
        z,
      },
    });
  // --- fin MODIFICADO ---

  const createSectionsSlicePlane = (heading = 0) =>
    new SlicePlane({
      heading,
      tilt: sectionPlaneTilt,
      width: sectionPlaneWidth,
      height: sectionPlaneHeight,
      position: {
        spatialReference: { latestWkid: 3857, wkid: 102100 },
        x: sectionCenterX,
        y: sectionCenterY,
        z: sectionCenterZ,
      },
    });

  const levelField = assetLayerConfig.fields.levelId;
  const levelNumberField = "LEVEL_NUMBER";

  const quoteSqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

  const buildSqlInClause = (fieldName: string, values: string[]) => {
    if (!values.length) {
      return "1=0";
    }

    return `${fieldName} IN (${values.map(quoteSqlString).join(",")})`;
  };

  const buildSqlNumberInClause = (fieldName: string, values: number[]) => {
    if (!values.length) {
      return "1=0";
    }

    return `${fieldName} IN (${values.join(",")})`;
  };

  const resolveFieldName = (layer: any, preferredFieldName: string) => {
    const fields = layer?.fields ?? [];
    const normalizedPreferred = preferredFieldName.toUpperCase();
    const match = fields.find((field: any) => String(field?.name ?? "").toUpperCase() === normalizedPreferred);
    return match?.name ?? null;
  };

  const resolveFirstExistingFieldName = (layer: any, candidates: string[]) => {
    for (const candidate of candidates) {
      const resolved = resolveFieldName(layer, candidate);
      if (resolved) {
        return resolved;
      }
    }

    return null;
  };

  const getFloorplanLevelFromTitle = (title: string | undefined) => {
    if (!title) {
      return null;
    }

    const match = title.match(/^Floorplan level\s+(\d+)$/i);
    if (!match) {
      return null;
    }

    const level = Number(match[1]);
    return Number.isFinite(level) ? level : null;
  };


  const hasLevelField = async (layer: any) => {
    if (supportsLevelFieldByLayerRef.current.has(layer)) {
      return supportsLevelFieldByLayerRef.current.get(layer) === true;
    }

    try {
      await layer?.load?.();
      const fields = layer?.fields ?? [];
      const hasField = fields.some((field: any) => field?.name?.toUpperCase?.() === levelField);
      supportsLevelFieldByLayerRef.current.set(layer, hasField);
      return hasField;
    } catch {
      supportsLevelFieldByLayerRef.current.set(layer, false);
      return false;
    }
  };


  const setLayerViewFilter = async (view: any, layer: any, where: string | null) => {
    try {
      const layerView = await view.whenLayerView(layer);
      if (!("filter" in layerView)) {
        return;
      }

      layerView.filter = where ? { where } : null;

      if (where) {
        filteredLayerViewsRef.current.add(layerView);
      } else {
        filteredLayerViewsRef.current.delete(layerView);
      }
    } catch {
      // Skip layers that do not produce a usable LayerView in the current view.
    }
  };

  const buildAssetsLayerWhere = async (layer: any, currentLevel: number | null, objectIds: number[] | null) => {
    const clauses: string[] = [];

    if (currentLevel !== null && levelLookupReady) {
      await layer?.load?.();

      let floorClause: string | null = null;
      const resolvedLevelField = resolveFieldName(layer, levelField);

      if (resolvedLevelField) {
        const activeLevelIds = getActiveLevelIds(currentLevel);
        if (activeLevelIds.length > 0) {
          floorClause = buildSqlInClause(resolvedLevelField, activeLevelIds);

          // Some layers expose LEVEL_ID but do not share lookup values; fallback when no matches exist.
          if (typeof layer?.queryFeatureCount === "function") {
            try {
              const levelIdCount = await layer.queryFeatureCount({ where: floorClause });
              if (levelIdCount === 0) {
                floorClause = null;
              }
            } catch {
              // Keep the LEVEL_ID clause when count probing is unavailable.
            }
          }
        }
      }

      if (!floorClause) {
        const numericLevelField = resolveFirstExistingFieldName(layer, [
          "LEVEL_NUMBER",
          "FLOOR_NUMBER",
          "FLOOR",
          "LEVEL",
        ]);

        if (numericLevelField) {
          floorClause = `${numericLevelField} = ${currentLevel}`;
        }
      }

      if (floorClause) {
        clauses.push(floorClause);
      }
    }

    if (objectIds) {
      clauses.push(buildSqlNumberInClause(objectIdField, objectIds));
    }

    if (!clauses.length) {
      return null;
    }

    return clauses.map((clause) => `(${clause})`).join(" AND ");
  };

  const applyAssetsLayerFilter = async (
    view: any,
    currentLevel: number | null,
    objectIds: number[] | null,
  ) => {
    const normalizedItemId = fireAssetsLayerItemId.trim().toLowerCase();
    const normalizedUrl = assetLayerConfig.serviceUrl.trim().replace(/\/+$/, "").toLowerCase();
    const layers = view?.map?.allLayers?.toArray?.() ?? [];
    const assetsLayer = layers.find((layer: any) => {
      const layerItemId = String(layer?.portalItem?.id ?? "").trim().toLowerCase();
      const layerUrl = String(layer?.url ?? "").trim().replace(/\/+$/, "").toLowerCase();
      return layerUrl === normalizedUrl || (normalizedItemId.length > 0 && layerItemId === normalizedItemId);
    });
    if (!assetsLayer) {
      return;
    }

    const where = await buildAssetsLayerWhere(assetsLayer, currentLevel, objectIds);
    await setLayerViewFilter(view, assetsLayer, where);
  };
  const getLayerEndpointUrl = (layer: any) => {
    const raw = String(layer?.url ?? "").replace(/\/+$/, "");
    if (/\/\d+$/.test(raw)) return raw; // already .../FeatureServer/0

    const layerId =
      typeof layer?.layerId === "number"
        ? layer.layerId
        : typeof layer?.sourceJSON?.id === "number"
          ? layer.sourceJSON.id
          : null;

    return layerId !== null ? `${raw}/${layerId}` : raw;
  };

  const resolveRenderer = async (layer: any) => {
    await layer?.load?.();

    // 1) Already present on layer instance
    if (layer?.renderer?.clone) {
      return layer.renderer;
    }

    // 2) Present in loaded source JSON
    const sourceRendererJson =
      layer?.sourceJSON?.drawingInfo?.renderer ?? layer?.sourceJSON?.renderer;
    if (sourceRendererJson) {
      return fromJSON(sourceRendererJson);
    }

    // 3) Pull from REST layer endpoint
    const layerUrl = getLayerEndpointUrl(layer);
    const response = await esriRequest(layerUrl, {
      query: { f: "json" },
      responseType: "json",
    });

    const rendererJson =
      response?.data?.drawingInfo?.renderer ?? response?.data?.renderer;
    return rendererJson ? fromJSON(rendererJson) : null;
  };

  const applyAssetsIconOccludedVisibility = async (view: any, mode: "visible" | "hidden") => {
    const normalizedItemId = fireAssetsLayerItemId.trim().toLowerCase();
    const normalizedUrl = assetLayerConfig.serviceUrl.trim().replace(/\/+$/, "").toLowerCase();
    const layers = view?.map?.allLayers?.toArray?.() ?? [];
    const assetsLayer = layers.find((layer: any) => {
      const layerItemId = String(layer?.portalItem?.id ?? "").trim().toLowerCase();
      const layerUrl = String(layer?.url ?? "").trim().replace(/\/+$/, "").toLowerCase();
      return layerUrl === normalizedUrl || (normalizedItemId.length > 0 && layerItemId === normalizedItemId);
    });

    const renderer = await resolveRenderer(assetsLayer);
    if (!renderer || typeof renderer.clone !== "function") {
      return;
    }

    const nextRenderer = renderer.clone();
    if (!nextRenderer || nextRenderer?.type !== "unique-value") {
      return;
    }
    for (const info of nextRenderer.uniqueValueInfos ?? []) {
      const sourceSymbol = info?.symbol;
      if (!sourceSymbol || typeof sourceSymbol.clone !== "function") {
        continue;
      }

      let symbol = sourceSymbol.clone();

      if (sourceSymbol.type !== "point-3d") {
        symbol = toPoint3DIconSymbol(sourceSymbol);
      } 
      if (!symbol) {
        continue;
      }
      const symbolLayers = symbol?.symbolLayers;
      if (!symbolLayers || typeof symbolLayers.getItemAt !== "function") {
        continue;
      }

      const layerCount =
        typeof symbolLayers.length === "number"
          ? symbolLayers.length
          : typeof symbolLayers.toArray === "function"
            ? symbolLayers.toArray().length
            : 0;

      for (let i = 0; i < layerCount; i += 1) {
        const symbolLayer = symbolLayers.getItemAt(i);
        if (symbolLayer?.type === "icon") {
          symbolLayer.occludedVisibility = { mode };
        }
      }

      info.symbol = symbol;
    }
    // console.log(nextRenderer.uniqueValueInfos[0].symbol.symbolLayers.getItemAt(0).occludedVisibility.mode);
    assetsLayer.renderer = nextRenderer.clone();
    // console.log(assetsLayer.renderer.uniqueValueInfos[0].symbol.symbolLayers.getItemAt(0).occludedVisibility.mode);
  };

  const restoreAllFilters = () => {
    for (const layerView of filteredLayerViewsRef.current) {
      try {
        if ("filter" in layerView) {
          layerView.filter = null;
        }
      } catch {
        // LayerView can become stale if its parent view/layer is destroyed.
      }
    }

    filteredLayerViewsRef.current.clear();

    for (const layer of managedFloorplanLayersRef.current) {
      try {
        const initialVisibility = initialFloorplanVisibilityByLayerRef.current.get(layer);
        if (typeof initialVisibility === "boolean" && "visible" in layer) {
          layer.visible = initialVisibility;
        }
      } catch {
        // Layer can become stale if parent map/view is destroyed.
      }
    }

    managedFloorplanLayersRef.current.clear();
    initialFloorplanVisibilityByLayerRef.current.clear();
  };

  const applyMapFloorplanVisibility = (view: any, currentLevel: number) => {
    const layers = view?.map?.allLayers?.toArray?.() ?? [];

    for (const layer of layers) {
      const floorplanLevel = getFloorplanLevelFromTitle(layer?.title);
      if (floorplanLevel === null || !("visible" in layer)) {
        continue;
      }

      if (!initialFloorplanVisibilityByLayerRef.current.has(layer)) {
        initialFloorplanVisibilityByLayerRef.current.set(layer, Boolean(layer.visible));
      }

      managedFloorplanLayersRef.current.add(layer);
      layer.visible = floorplanLevel === currentLevel;
    }
  };

  const applyStadiumLayerVisibility = (view: any, floorsToggleActive: boolean) => {
    const layers = view?.map?.allLayers?.toArray?.() ?? [];

    for (const layer of layers) {
      if (!("visible" in layer)) {
        continue;
      }
      if (layer?.title === "BCplace stadium overview") {
        layer.visible = !floorsToggleActive;
      }
    }
  };

  // FASE 2 PENDIENTE: este filtrado usaba el lookup de niveles de Vancouver
  // (GUIDs de LEVEL_ID de BC Place). En la escena de Bloque A UPS las capas
  // Indoors (Levels, Units, Details...) SÍ tienen campo LEVEL_ID, así que
  // aplicarles IDs ajenos las dejaba EN BLANCO al activar PISOS ("1=0" o
  // 0 coincidencias). Neutralizado hasta reconstruirlo con el layer "Levels"
  // real de la escena (el corte geométrico por piso NO depende de esto).
  const applyFloorFilters = async (_view: any, _currentLevel: number) => {
    return;
  };

  // === TEMPORAL: CALIBRACIÓN — ELIMINAR ANTES DE LA DEMO ===
  // Expone la vista en window.__view y loguea el z LOCAL de cada clic en la
  // escena. Uso: haz clic sobre la línea de cada losa en la fachada del BIM,
  // anota los z reales y reemplaza los provisionales de floorLevels.
  useEffect(() => {
    if (!sceneView) {
      return;
    }

    (window as any).__view = sceneView;
    const clickHandle = sceneView.on("click", (event: any) => {
      console.log(
        "[Calibración] z del punto clickeado:",
        event.mapPoint?.z?.toFixed?.(2),
        event.mapPoint?.toJSON?.(),
      );
    });

    return () => {
      clickHandle?.remove?.();
    };
  }, [sceneView]);
  // === fin TEMPORAL ===

  // --- AUTOCALIBRACIÓN DEL RANGO VERTICAL DEL EDIFICIO ---
  // Lee zmin/zmax del fullExtent del BuildingSceneLayer (BIM). A diferencia de
  // ground.queryElevation() (elevación GLOBAL, incompatible con esta Local
  // Scene), el extent del layer está por definición en el marco vertical de la
  // propia escena: es la fuente autoritativa para posicionar los cortes.
  // Cuando el rango llega, floorLevels → activeZ cambian y el efecto de
  // animación existente reubica el plano solo: se auto-corrige en caliente.
  useEffect(() => {
    if (!sceneView) {
      return;
    }

    let cancelled = false;

    const containsBuildingCenter = (extent: any) =>
      extent &&
      extent.xmin <= sectionCenterX && sectionCenterX <= extent.xmax &&
      extent.ymin <= sectionCenterY && sectionCenterY <= extent.ymax;

    const extentArea = (extent: any) =>
      (extent.xmax - extent.xmin) * (extent.ymax - extent.ymin);

    const resolveBuildingZRange = async () => {
      await sceneView.when();
      const allLayers = sceneView.map?.allLayers?.toArray?.() ?? [];

      // 1) Preferimos el BuildingSceneLayer (el BIM). 2) Si no hay, el
      // SceneLayer que contenga el centro del edificio con MENOR área de
      // extent (para esquivar capas ciudad-completa tipo "OSM Buildings").
      let target: any =
        allLayers.find((layer: any) => layer?.type === "building-scene") ?? null;

      if (!target) {
        const sceneLayers = allLayers.filter((layer: any) => layer?.type === "scene");
        for (const layer of sceneLayers) {
          try {
            await layer?.load?.();
          } catch {
            // Capa que no carga: se ignora como candidata.
          }
        }
        const containing = sceneLayers.filter((layer: any) => containsBuildingCenter(layer?.fullExtent));
        containing.sort((a: any, b: any) => extentArea(a.fullExtent) - extentArea(b.fullExtent));
        target = containing[0] ?? null;
      }

      if (!target) {
        console.warn(
          "[SceneTools] Autocalibración: no encontré BuildingSceneLayer/SceneLayer del BIM; usando respaldo z",
          { zmin: buildingBaseZ - 18, zmax: buildingBaseZ },
        );
        return;
      }

      try {
        await target?.load?.();
      } catch {
        // Si la capa objetivo no carga, se mantiene el respaldo.
      }

      const extent = target?.fullExtent;
      if (cancelled || !extent || typeof extent.zmin !== "number" || typeof extent.zmax !== "number") {
        console.warn("[SceneTools] Autocalibración: el layer no expone zmin/zmax en fullExtent", target?.title, extent);
        return;
      }

      console.log("[SceneTools] Rango vertical REAL del BIM →", {
        layer: target.title,
        zmin: extent.zmin,
        zmax: extent.zmax,
      });
      setBuildingZRange({ zmin: extent.zmin, zmax: extent.zmax });
    };

    void resolveBuildingZRange();

    return () => {
      cancelled = true;
    };
  }, [sceneView]);
  // --- fin AUTOCALIBRACIÓN ---

  useEffect(() => {
    let cancelled = false;

    const loadLevelLookup = async () => {
      try {
        const lookupLayer = new FeatureLayer({
          url: levelLookupUrl,
        });

        const result = await lookupLayer.queryFeatures({
          where: "1=1",
          outFields: [levelField, levelNumberField],
          returnGeometry: false,
        });

        if (cancelled) {
          return;
        }

        const nextLevelIdsByNumber = new Map<number, string[]>();
        const nextLevelNumberById = new Map<string, number>();

        for (const feature of result.features ?? []) {
          const levelId = feature?.attributes?.[levelField];
          const levelNumber = Number(feature?.attributes?.[levelNumberField]);

          if (levelId === undefined || levelId === null || Number.isNaN(levelNumber)) {
            continue;
          }

          const normalizedLevelId = String(levelId);
          nextLevelNumberById.set(normalizedLevelId, levelNumber);

          const ids = nextLevelIdsByNumber.get(levelNumber) ?? [];
          ids.push(normalizedLevelId);
          nextLevelIdsByNumber.set(levelNumber, ids);
        }

        levelIdsByNumberRef.current = nextLevelIdsByNumber;
        levelNumberByIdRef.current = nextLevelNumberById;

      } catch {
        // If lookup fails, keep map empty so filters safely resolve to no matches.
        levelIdsByNumberRef.current = new Map();
        levelNumberByIdRef.current = new Map();
      } finally {
        if (!cancelled) {
          setLevelLookupReady(true);
        }
      }
    };

    void loadLevelLookup();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const setupSlice = async () => {
      const view = sceneView;
      if (!view) {
        return;
      }

      const sliceAnalysis =
        sliceAnalysisRef.current ??
        new SliceAnalysis({
          tiltEnabled: true,
          excludeGroundSurface: true,
          shape: createSlicePlane(animatedZRef.current),
        });

      sliceAnalysisRef.current = sliceAnalysis;
      sliceAnalysis.excludeGroundSurface = true;

      const excludedLayers =
        view.map?.allLayers
          ?.toArray()
          .filter((layer: any) => excludedLayerTitles.includes(layer?.title)) ?? [];

      sliceAnalysis.excludedLayers = excludedLayers;

      const layerSummary = view.map?.allLayers?.toArray()?.map(
  (l: any) => `${l.title ?? "(sin título)"} | type=${l.type} | layerType=${l.layerType}`
).join('\n');
console.log('[SceneTools] CAPAS OPERATIVAS en la escena:\n' + layerSummary);

      if (navigationState.toggles.floors) {
        if (view.analyses.indexOf(sliceAnalysis) === -1) {
          view.analyses.add(sliceAnalysis);
        }

        const analysisView = await view.whenAnalysisView(sliceAnalysis);
        analysisView.active = true;
      } else if (view.analyses.indexOf(sliceAnalysis) !== -1) {
        view.analyses.remove(sliceAnalysis);
      }
    };

    void setupSlice();
  }, [sceneView, navigationState.toggles.floors]);

  useEffect(() => {
    const setupSectionsSlice = async () => {
      const view = sceneView;
      if (!view) {
        return;
      }

      const excludedLayers =
        view.map?.allLayers
          ?.toArray()
          .filter((layer: any) => excludedLayerTitles.includes(layer?.title)) ?? [];

      const sectionsSliceAnalysis =
        sectionsSliceAnalysisRef.current ??
        new SliceAnalysis({
          tiltEnabled: false,
          excludeGroundSurface: true,
          excludedLayers,
          shape: createSectionsSlicePlane(147.5228646554149),
        });

      sectionsSliceAnalysisRef.current = sectionsSliceAnalysis;

      if (navigationState.toggles.sections) {
        if (view.analyses.indexOf(sectionsSliceAnalysis) === -1) {
          view.analyses.add(sectionsSliceAnalysis);
        }

        const sectionsAnalysisView = await view.whenAnalysisView(sectionsSliceAnalysis);
sectionsAnalysisView.active = true;
sectionsAnalysisView.interactive = true;
console.log('[SceneTools] Sections slice AGREGADO y activo', {
  position: sectionsSliceAnalysis.shape?.position,
  inAnalyses: view.analyses.indexOf(sectionsSliceAnalysis) !== -1,
  analysisViewActive: sectionsAnalysisView.active,
});

        sectionsSliceShapeWatchHandleRef.current?.remove?.();
        // remove the lock-in, place initial position of the slice and if user moves it, they can re-center it.
        // sectionsSliceShapeWatchHandleRef.current = reactiveUtils.watch(() => sectionsSliceAnalysis.shape, (shape: any) => {
        //   if (!shape || syncingSectionsSliceShapeRef.current) {
        //     return;
        //   }

        //   const needsRecenter =
        //     Math.abs((shape?.position?.x ?? sectionCenterX) - sectionCenterX) > 0.001 ||
        //     Math.abs((shape?.position?.y ?? sectionCenterY) - sectionCenterY) > 0.001 ||
        //     Math.abs((shape?.position?.z ?? sectionCenterZ) - sectionCenterZ) > 0.001;

        //   const needsVerticalTilt = Math.abs((shape?.tilt ?? sectionPlaneTilt) - sectionPlaneTilt) > 0.001;

        //   if (!needsRecenter && !needsVerticalTilt) {
        //     return;
        //   }

        //   syncingSectionsSliceShapeRef.current = true;

        //   try {
        //     sectionsSliceAnalysis.shape = createSectionsSlicePlane(shape?.heading ?? 0);
        //   } finally {
        //     syncingSectionsSliceShapeRef.current = false;
        //   }
        // });

        return;
      }

      sectionsSliceShapeWatchHandleRef.current?.remove?.();
      sectionsSliceShapeWatchHandleRef.current = null;

      if (view.analyses.indexOf(sectionsSliceAnalysis) !== -1) {
        view.analyses.remove(sectionsSliceAnalysis);
      }
    };

    void setupSectionsSlice();
  }, [sceneView, navigationState.toggles.sections]);

  useEffect(() => {
    if (!navigationState.toggles.floors) {
      return;
    }

    const sliceAnalysis = sliceAnalysisRef.current;
    if (!sliceAnalysis) {
      return;
    }

    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const startZ = animatedZRef.current;
    const endZ = activeZ;
    const duration = 1500;

    if (Math.abs(endZ - startZ) < 0.0001) {
      sliceAnalysis.shape = createSlicePlane(endZ);
      animatedZRef.current = endZ;
      return;
    }

    console.log('[SceneTools] animando plano de Floors', { startZ, endZ, selectedLevel });
    const startTime = performance.now();

    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const rawProgress = Math.min(elapsed / duration, 1);
      const progress = easeInOutCubic(rawProgress);
      const z = startZ + (endZ - startZ) * progress;

      sliceAnalysis.shape = createSlicePlane(z);
      animatedZRef.current = z;

      if (rawProgress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = window.requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [activeZ, navigationState.toggles.floors]);

  useEffect(() => {
    return () => {
      const view = sceneView;
      const sliceAnalysis = sliceAnalysisRef.current;

      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      if (view && sliceAnalysis && view.analyses.indexOf(sliceAnalysis) !== -1) {
        view.analyses.remove(sliceAnalysis);
      }

      const sectionsSliceAnalysis = sectionsSliceAnalysisRef.current;
      sectionsSliceShapeWatchHandleRef.current?.remove?.();
      sectionsSliceShapeWatchHandleRef.current = null;

      if (view && sectionsSliceAnalysis && view.analyses.indexOf(sectionsSliceAnalysis) !== -1) {
        view.analyses.remove(sectionsSliceAnalysis);
      }

      restoreAllFilters();
    };
  }, [sceneView]);

  // Comandos del asistente de IA relacionados con pisos.
  useEffect(() => {
    const cmd = assistantStore.command;
    if (!cmd || cmd.tool !== "ir_a_piso") return;
    const nivel = Number(cmd.args?.nivel);
    if (nivel >= 1 && nivel <= 4) {
      if (!navigationState.toggles.floors) {
        navigationState.toggle("floors"); // enciende el modo Pisos si estaba apagado
      }
      setSelectedLevel(nivel);
    }
  }, [assistantStore.command?.id]);

  useEffect(() => {
    let cancelled = false;

    const syncAssetFilters = async () => {
      const currentLevel = navigationState.toggles.floors ? selectedLevel : null;
      const objectIds = navigationState.toggles.assets ? visibleAssetObjectIds : null;

      if (sceneView) {
        await applyAssetsLayerFilter(sceneView, currentLevel, objectIds);
      }

      if (mapView) {
        await applyAssetsLayerFilter(mapView, currentLevel, objectIds);
      }

      if (cancelled) {
        return;
      }
    };

    void syncAssetFilters();

    return () => {
      cancelled = true;
    };
  }, [sceneView, mapView, selectedLevel, visibleAssetObjectIds, levelLookupReady, navigationState.toggles.assets, navigationState.toggles.floors]);

  useEffect(() => {
    let cancelled = false;

    const runFiltering = async () => {
      if (!navigationState.toggles.floors) {
        restoreAllFilters();
        if (sceneView) {
          applyAssetsIconOccludedVisibility(sceneView, "hidden");
        }
        // When floors toggle is off, restore stadium layer visibility
        if (mapView) {
          applyStadiumLayerVisibility(mapView, false);
        }
        if (sceneView) {
          applyStadiumLayerVisibility(sceneView, false);
        }
        return;
      }

      if (mapView) {
        applyMapFloorplanVisibility(mapView, selectedLevel);
        applyStadiumLayerVisibility(mapView, true);
      }

      if (sceneView && navigationState.toggles.floors) {
        applyAssetsIconOccludedVisibility(sceneView, "visible");
      }

      if (!levelLookupReady) {
        return;
      }

      if (!sceneView && !mapView) {
        return;
      }

      if (sceneView) {
        await applyFloorFilters(sceneView, selectedLevel);
        applyStadiumLayerVisibility(sceneView, true);
      }

      if (mapView) {
        await applyFloorFilters(mapView, selectedLevel);
      }

      if (cancelled) {
        return;
      }
    };

    void runFiltering();

    return () => {
      cancelled = true;
    };
  }, [sceneView, mapView, selectedLevel, navigationState.toggles.floors, levelLookupReady]);

  useEffect(() => {
    const anyPanelActive = Object.values(navigationState.toggles).some(Boolean);
    const normalizedItemId = fireAssetsLayerItemId.trim().toLowerCase();
    const normalizedUrl = assetLayerConfig.serviceUrl.trim().replace(/\/+$/, "").toLowerCase();

    const setAssetLayerVisibility = (view: any) => {
      const layers = view?.map?.allLayers?.toArray?.() ?? [];
      const assetsLayer = layers.find((layer: any) => {
        const layerItemId = String(layer?.portalItem?.id ?? "").trim().toLowerCase();
        const layerUrl = String(layer?.url ?? "").trim().replace(/\/+$/, "").toLowerCase();
        return layerUrl === normalizedUrl || (normalizedItemId.length > 0 && layerItemId === normalizedItemId);
      });
      if (assetsLayer) {
        assetsLayer.visible = anyPanelActive;
      }
    };

    if (sceneView) setAssetLayerVisibility(sceneView);
    if (mapView) setAssetLayerVisibility(mapView);
  }, [sceneView, mapView, navigationState.toggles.assets, navigationState.toggles.floors, navigationState.toggles.sections, navigationState.toggles.bookmarks, navigationState.toggles.analysis, navigationState.toggles.imagery, navigationState.toggles.basemap]);

  useEffect(() => {
    const imageryOn = navigationState.toggles.imagery;
    const imageryLayerTitles = new Set([
      "stadium survey images pavco public",
      "survey arrows",
      orientedImageryConfig.title.trim().toLowerCase(), // grupo Mapillary (Living Atlas)
    ]);

    const setLayerVisibility = (view: any) => {
      view?.map?.allLayers?.forEach((layer: any) => {
        const normalizedTitle = String(layer?.title ?? "").trim().toLowerCase();
        if (imageryLayerTitles.has(normalizedTitle)) {
          layer.visible = imageryOn;
        }
      });
    };

    if (sceneView) setLayerVisibility(sceneView);
    if (mapView) setLayerVisibility(mapView);
  }, [sceneView, mapView, navigationState.toggles.imagery]);

   if (!navigationState.toggles.assets && !navigationState.toggles.floors && !navigationState.toggles.sections && !navigationState.toggles.analysis && !navigationState.toggles.imagery && !navigationState.toggles.basemap && !navigationState.toggles.security) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.topLeft}>
        {navigationState.toggles.assets ? (
          <div className={styles.assets}>
            <AssetsPanel
              sceneId={sceneId}
              activeLevelIds={activeLevelIdsForAssets}
              onVisibleAssetObjectIdsChange={setVisibleAssetObjectIds}
            ></AssetsPanel>
          </div>
        ) : null}

        {navigationState.toggles.floors ? (
          <div className={styles.floors}>
            <FloorPicker level={selectedLevel} onLevelChange={setSelectedLevel}></FloorPicker>
          </div>
        ) : null}
      </div>

      {(navigationState.toggles.analysis || navigationState.toggles.imagery || navigationState.toggles.basemap || navigationState.toggles.security) ? (
        <div className={styles.topRight}>
          {navigationState.toggles.security ? (
            <div className={styles.analysis}>
              <SecurityPanel sceneId={sceneId}></SecurityPanel>
            </div>
          ) : null}
          {navigationState.toggles.analysis ? (
            <div className={styles.analysis}>
              <AnalysisPanel sceneId={sceneId}></AnalysisPanel>
            </div>
          ) : null}
          {navigationState.toggles.imagery ? (
            <div className={styles.imagery}>
              <ImageryPanel sceneId={sceneId}></ImageryPanel>
            </div>
          ) : null}
          {navigationState.toggles.basemap && navigationState.viewMode !== "map-only" ? (
            <div className={styles.basemap}>
              <BasemapPanel sceneId={sceneId}></BasemapPanel>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});