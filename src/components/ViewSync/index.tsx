import { useEffect, useRef } from "react";
import { observer } from "mobx-react-lite";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import state from "../../stores/state";

type SyncSource = "scene" | "map";

const SYNC_THROTTLE_MS = 16;
const CONTROL_RELEASE_DELAY_MS = 160;
const ZOOM_OFFSET_2D_TO_3D = 2;
const ENABLE_NORTH_ALIGNMENT_MODE = true;
const NORTH_ALIGNMENT_SCENE_TILT = 0.2;

interface SyncSnapshot {
  center: any | null;
  zoom: number | null;
  scale: number | null;
  heading: number | null;
}

const normalizeHeading = (heading: number) => {
  const normalized = heading % 360;
  return normalized < 0 ? normalized + 360 : normalized;
};

const mapRotationToSceneHeading = (rotation: number) => normalizeHeading(-rotation);
const sceneHeadingToMapRotation = (heading: number) => normalizeHeading(-heading);

export const ViewSync = observer(() => {
  const sceneView = state.getView("scene");
  const mapView = state.getView("map");
  const activeViewId = state.activeViewId;

  const isApplyingSyncRef = useRef(false);
  const lastSyncAtRef = useRef(0);
  const controllingSourceRef = useRef<SyncSource | null>(null);
  const releaseControlTimerRef = useRef<number | null>(null);

  useEffect(() => {
    console.log('[ViewSync] effect running', {
      hasSceneView: !!sceneView,
      hasMapView: !!mapView,
      activeViewId,
    });

    if (!sceneView || !mapView) {
      console.log('[ViewSync] missing a view, bailing out of effect');
      return;
    }

    const clearReleaseTimer = () => {
      if (releaseControlTimerRef.current !== null) {
        window.clearTimeout(releaseControlTimerRef.current);
        releaseControlTimerRef.current = null;
      }
    };

    const setController = (source: SyncSource) => {
      console.log('[ViewSync] setController ->', source);
      clearReleaseTimer();
      controllingSourceRef.current = source;
    };

    const scheduleControlRelease = () => {
      clearReleaseTimer();
      releaseControlTimerRef.current = window.setTimeout(() => {
        console.log('[ViewSync] control released (timeout)');
        controllingSourceRef.current = null;
        releaseControlTimerRef.current = null;
      }, CONTROL_RELEASE_DELAY_MS);
    };

    const applyViewpoint = async (source: any, target: any) => {
      console.log('[ViewSync] applyViewpoint called', {
        sourceType: source?.type,
        targetType: target?.type,
        hasSource: !!source,
        hasTarget: !!target,
        isApplyingSync: isApplyingSyncRef.current,
      });

      if (!source || !target || isApplyingSyncRef.current) {
        console.log('[ViewSync] applyViewpoint early return (missing source/target or already applying)');
        return;
      }

      const now = Date.now();
      if (now - lastSyncAtRef.current < SYNC_THROTTLE_MS) {
        console.log('[ViewSync] applyViewpoint throttled, skipping');
        return;
      }

      const center = source.center?.clone?.() ?? source.center ?? null;
      const zoom = Number.isFinite(source.zoom) ? source.zoom : null;
      const scale = Number.isFinite(source.scale) ? source.scale : null;
      const heading = Number.isFinite(source.rotation)
        ? mapRotationToSceneHeading(source.rotation)
        : Number.isFinite(source.camera?.heading)
          ? source.camera.heading
          : null;

      console.log('[ViewSync] snapshot values', {
        center: center ? { x: center.x, y: center.y, spatialReference: center.spatialReference } : null,
        zoom,
        scale,
        heading,
      });

      const snapshot: SyncSnapshot = {
        center,
        zoom,
        scale,
        heading: heading !== null && Number.isFinite(heading) ? normalizeHeading(heading) : null,
      };

      if (!snapshot.center) {
        console.log('[ViewSync] applyViewpoint aborted: snapshot.center is null');
        return;
      }

      isApplyingSyncRef.current = true;
      lastSyncAtRef.current = now;

      try {
        const targetIsMap = target.type === "2d";
        const sourceIsMap = source.type === "2d";

        if (snapshot.center) {
          target.center = snapshot.center;
        }

        if (snapshot.zoom !== null) {
          let adjustedZoom = snapshot.zoom;

          if (sourceIsMap && !targetIsMap) {
            adjustedZoom += ZOOM_OFFSET_2D_TO_3D;
          } else if (!sourceIsMap && targetIsMap) {
            adjustedZoom -= ZOOM_OFFSET_2D_TO_3D;
          }

          target.zoom = Math.max(0, adjustedZoom);
          console.log('[ViewSync] applied zoom ->', target.zoom, '(adjusted from', snapshot.zoom, ')');
        } else if (snapshot.scale !== null && Number.isFinite(snapshot.scale)) {
          target.scale = snapshot.scale;
          console.log('[ViewSync] applied scale ->', target.scale);
        } else {
          console.log('[ViewSync] no zoom AND no scale available to apply — target left unchanged on that axis');
        }

        if (targetIsMap) {
          if (snapshot.heading !== null && Number.isFinite(snapshot.heading)) {
            target.rotation = sceneHeadingToMapRotation(snapshot.heading);
          }
        } else {
          const camera = target.camera?.clone?.();
          if (camera && snapshot.heading !== null && Number.isFinite(snapshot.heading)) {
            camera.heading = normalizeHeading(snapshot.heading);

            // if (ENABLE_NORTH_ALIGNMENT_MODE && sourceIsMap) {
            //   camera.tilt = NORTH_ALIGNMENT_SCENE_TILT;
            // }

            target.camera = camera;
          }
        }

        console.log('[ViewSync] applyViewpoint SUCCESS', {
          targetType: target.type,
          targetCenter: target.center ? { x: target.center.x, y: target.center.y } : null,
          targetZoom: target.zoom,
          targetScale: target.scale,
        });
      } catch (err) {
        console.log('[ViewSync] applyViewpoint threw an error', err);
      } finally {
        window.requestAnimationFrame(() => {
          isApplyingSyncRef.current = false;
        });
      }
    };

    const syncFrom = (sourceId: SyncSource) => {
      const source = sourceId === "scene" ? sceneView : mapView;
      const target = sourceId === "scene" ? mapView : sceneView;

      const sourceIsActive = Boolean(source?.interacting || source?.animation);

      console.log('[ViewSync] syncFrom called', {
        sourceId,
        sourceIsActive,
        controllingSource: controllingSourceRef.current,
      });

      if (sourceIsActive) {
        setController(sourceId);
      }

      if (controllingSourceRef.current && controllingSourceRef.current !== sourceId) {
        console.log('[ViewSync] syncFrom blocked: another source is in control ->', controllingSourceRef.current);
        return;
      }

      if (!sourceIsActive && controllingSourceRef.current !== sourceId) {
        console.log('[ViewSync] syncFrom blocked: source not active and not the controller');
        return;
      }

      if (sourceId === "scene") {
        void applyViewpoint(sceneView, mapView);
      } else {
        void applyViewpoint(mapView, sceneView);
      }
    };

    const initialSource = activeViewId === "map" ? "map" : "scene";
    console.log('[ViewSync] initialSource =', initialSource, '| waiting for both views to be ready...');
    setController(initialSource);

    Promise.all([sceneView.when(), mapView.when()])
      .then(() => {
        console.log('[ViewSync] BOTH views resolved .when() — calling syncFrom(', initialSource, ')');
        console.log('[ViewSync] sceneView state at ready:', {
          center: sceneView.center ? { x: sceneView.center.x, y: sceneView.center.y } : null,
          zoom: sceneView.zoom,
          scale: sceneView.scale,
        });
        console.log('[ViewSync] mapView state at ready:', {
          center: mapView.center ? { x: mapView.center.x, y: mapView.center.y } : null,
          zoom: mapView.zoom,
          scale: mapView.scale,
        });
        syncFrom(initialSource);
      })
      .catch((err) => {
        console.log('[ViewSync] ERROR while waiting for views to be ready', err);
      });

    const sceneHandle = reactiveUtils.watch(() => sceneView.viewpoint, () => {
      console.log('[ViewSync] sceneView.viewpoint CHANGED (watch fired)');
      syncFrom("scene");
    });

    const mapHandle = reactiveUtils.watch(() => mapView.viewpoint, () => {
      console.log('[ViewSync] mapView.viewpoint CHANGED (watch fired)');
      syncFrom("map");
    });

    const sceneInteractingHandle = reactiveUtils.watch(() => sceneView.interacting, (isInteracting: boolean) => {
      console.log('[ViewSync] sceneView.interacting ->', isInteracting);
      if (isInteracting) {
        setController("scene");
        return;
      }

      if (!mapView.interacting && !sceneView.animation && !mapView.animation) {
        scheduleControlRelease();
      }
    });

    const mapInteractingHandle = reactiveUtils.watch(() => mapView.interacting, (isInteracting: boolean) => {
      console.log('[ViewSync] mapView.interacting ->', isInteracting);
      if (isInteracting) {
        setController("map");
        return;
      }

      if (!sceneView.interacting && !sceneView.animation && !mapView.animation) {
        scheduleControlRelease();
      }
    });

    return () => {
      console.log('[ViewSync] effect cleanup');
      clearReleaseTimer();
      sceneHandle?.remove?.();
      mapHandle?.remove?.();
      sceneInteractingHandle?.remove?.();
      mapInteractingHandle?.remove?.();
    };
  }, [sceneView, mapView, activeViewId]);

  return null;
});