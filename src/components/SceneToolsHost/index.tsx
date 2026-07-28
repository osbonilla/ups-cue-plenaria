import React, { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import SliceAnalysis from "@arcgis/core/analysis/SliceAnalysis";
import SlicePlane from "@arcgis/core/analysis/SlicePlane";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import Point from "@arcgis/core/geometry/Point";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import { assetLayerConfig } from "../../config";
import state from "../../stores/state";
import navigationState from "../../stores/navigation";
import { AssetsPanel } from "../AssetsPanel";
import { FloorPicker } from "../FloorPicker";
import { AnalysisPanel } from "../AnalysisPanel";
import { ImageryPanel } from "../ImageryPanel";
import { BasemapPanel } from "../BasemapPanel";
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
  const [sectionCenterX, sectionCenterY] = [-8737376.607724095, -23125.283681528585];

  // --- NUEVO: elevación real del terreno en el campus (Quito ~2850 msnm) ---
  // Los valores originales (sectionCenterZ = 25, floorLevels 7.7-24.56) estaban
  // calibrados para Vancouver (nivel del mar) y dejaban el plano de corte a
  // ~2800 m bajo tierra en Quito. Consultamos la elevación real una sola vez
  // cuando la escena está lista, con un valor de respaldo mientras carga.
  const [groundElevation, setGroundElevation] = useState<number | null>(null);
  const sectionCenterZ = groundElevation ?? 10;
  // --- fin NUEVO ---

  const sectionPlaneWidth = 300;
  const sectionPlaneHeight = 130;
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

  // --- MODIFICADO: floorLevels ahora usa la elevación real como base ---
  // Antes: alturas absolutas de Vancouver (7.7, 13, 19, 24.56 msnm).
  // Ahora: elevación real del terreno + alturas de piso relativas (~5m c/u,
  // ajústalas cuando tengas las alturas reales de tu BIM).
  const floorLevels = useMemo(
    () => {
      const base = groundElevation ?? 2850;
      return [
        { level: 1, z: base + 4 },
        { level: 2, z: base + 9 },
        { level: 3, z: base + 14 },
        { level: 4, z: base + 19 },
      ];
    },
    [groundElevation],
  );
  // --- fin MODIFICADO ---

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
      heading: 51.76797514952818,
      tilt: 0.00024752456693022395,
      width: 1000,
      height: 1000,
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

  const applyFloorFilters = async (view: any, currentLevel: number) => {
    const activeLevelIds = getActiveLevelIds(currentLevel);
    const normalizedAssetUrl = assetLayerConfig.serviceUrl.trim().replace(/\/+$/, "").toLowerCase();
    const normalizedAssetItemId = fireAssetsLayerItemId.trim().toLowerCase();

    const layers = view?.map?.allLayers?.toArray?.() ?? [];

    for (const layer of layers) {
      const layerUrl = String(layer?.url ?? "").trim().replace(/\/+$/, "").toLowerCase();
      const layerItemId = String(layer?.portalItem?.id ?? "").trim().toLowerCase();
      if (layerUrl === normalizedAssetUrl || (normalizedAssetItemId.length > 0 && layerItemId === normalizedAssetItemId)) {
        continue;
      }

      const supportsFloorFilter = await hasLevelField(layer);
      if (!supportsFloorFilter || ["BCplace - level1", "BCplace - level2", "BCplace - level3", "BCplace - level4"].includes(layer.title)) {
        await setLayerViewFilter(view, layer, null);
        continue;
      }

      const whereEquals = buildSqlInClause(levelField, activeLevelIds);
      await setLayerViewFilter(view, layer, whereEquals);
    }
  };

  // --- NUEVO: consulta la elevación real del terreno una sola vez ---
  useEffect(() => {
    if (!sceneView) {
      return;
    }

    let cancelled = false;

    sceneView.when(() => {
      if (cancelled) {
        return;
      }

      const point = new Point({
        x: sectionCenterX,
        y: sectionCenterY,
        spatialReference: { wkid: 102100 },
      });

      sceneView.map?.ground
  ?.queryElevation(point)
  .then((result: any) => {
    console.log('[SceneTools] queryElevation SUCCESS ->', result?.geometry?.z, result);
    if (!cancelled && result?.geometry?.z !== undefined) {
      setGroundElevation(result.geometry.z);
    }
  })
  .catch((err: any) => {
    console.log('[SceneTools] queryElevation FAILED, usando respaldo 2850 ->', err);
  });
    });

    return () => {
      cancelled = true;
    };
  }, [sceneView]);
  // --- fin NUEVO ---

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
          shape: createSectionsSlicePlane(0),
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
    const sectionsSliceAnalysis = sectionsSliceAnalysisRef.current;
    if (!sectionsSliceAnalysis) {
      return;
    }
    const currentHeading = sectionsSliceAnalysis.shape?.heading ?? 0;
    sectionsSliceAnalysis.shape = createSectionsSlicePlane(currentHeading);
  }, [sectionCenterZ]);

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

    console.log('[SceneTools] animando plano de Floors', { startZ, endZ, selectedLevel, groundElevation });
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

  if (!navigationState.toggles.assets && !navigationState.toggles.floors && !navigationState.toggles.sections && !navigationState.toggles.analysis && !navigationState.toggles.imagery && !navigationState.toggles.basemap) {
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

      {(navigationState.toggles.analysis || navigationState.toggles.imagery || navigationState.toggles.basemap) ? (
        <div className={styles.topRight}>
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