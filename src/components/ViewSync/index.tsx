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
    if (!sceneView || !mapView) {
      return;
    }

    const clearReleaseTimer = () => {
      if (releaseControlTimerRef.current !== null) {
        window.clearTimeout(releaseControlTimerRef.current);
        releaseControlTimerRef.current = null;
      }
    };

    const setController = (source: SyncSource) => {
      clearReleaseTimer();
      controllingSourceRef.current = source;
    };

    const scheduleControlRelease = () => {
      clearReleaseTimer();
      releaseControlTimerRef.current = window.setTimeout(() => {
        controllingSourceRef.current = null;
        releaseControlTimerRef.current = null;
      }, CONTROL_RELEASE_DELAY_MS);
    };

    const applyViewpoint = async (source: any, target: any) => {
      if (!source || !target || isApplyingSyncRef.current) {
        return;
      }

      const now = Date.now();
      if (now - lastSyncAtRef.current < SYNC_THROTTLE_MS) {
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

      const snapshot: SyncSnapshot = {
        center,
        zoom,
        scale,
        heading: heading !== null && Number.isFinite(heading) ? normalizeHeading(heading) : null,
      };

      if (!snapshot.center) {
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
        } else if (snapshot.scale !== null && Number.isFinite(snapshot.scale)) {
          target.scale = snapshot.scale;
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
      } catch {
        // Ignore view state errors during rapid interaction.
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

      if (sourceIsActive) {
        setController(sourceId);
      }

      if (controllingSourceRef.current && controllingSourceRef.current !== sourceId) {
        return;
      }

      if (!sourceIsActive && controllingSourceRef.current !== sourceId) {
        return;
      }

      if (sourceId === "scene") {
        void applyViewpoint(sceneView, mapView);
      } else {
        void applyViewpoint(mapView, sceneView);
      }
    };

    const initialSource = activeViewId === "map" ? "map" : "scene";
    setController(initialSource);
    syncFrom(initialSource);

    const sceneHandle = reactiveUtils.watch(() => sceneView.viewpoint, () => {
      syncFrom("scene");
    });

    const mapHandle = reactiveUtils.watch(() => mapView.viewpoint, () => {
      syncFrom("map");
    });

    const sceneInteractingHandle = reactiveUtils.watch(() => sceneView.interacting, (isInteracting: boolean) => {
      if (isInteracting) {
        setController("scene");
        return;
      }

      if (!mapView.interacting && !sceneView.animation && !mapView.animation) {
        scheduleControlRelease();
      }
    });

    const mapInteractingHandle = reactiveUtils.watch(() => mapView.interacting, (isInteracting: boolean) => {
      if (isInteracting) {
        setController("map");
        return;
      }

      if (!sceneView.interacting && !sceneView.animation && !mapView.animation) {
        scheduleControlRelease();
      }
    });

    return () => {
      clearReleaseTimer();
      sceneHandle?.remove?.();
      mapHandle?.remove?.();
      sceneInteractingHandle?.remove?.();
      mapInteractingHandle?.remove?.();
    };
  }, [sceneView, mapView, activeViewId]);

  return null;
});
