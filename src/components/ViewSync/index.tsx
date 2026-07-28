import { useEffect, useRef } from "react";
import { observer } from "mobx-react-lite";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import state from "../../stores/state";

type SyncSource = "scene" | "map";

export const ViewSync = observer(() => {
  const sceneView = state.getView("scene");
  const mapView = state.getView("map");

  // Tracks which view the user (or a programmatic animation, e.g. bookmarks)
  // last drove. The OTHER view always follows. No timers, no manual
  // scale/zoom/rotation math — we hand the whole viewpoint object to the
  // SDK and let it translate between 2D and 3D internally.
  const activeRef = useRef<SyncSource | null>(null);

  useEffect(() => {
    if (!sceneView || !mapView) {
      return;
    }

    let cancelled = false;
    const handles: any[] = [];

    Promise.all([sceneView.when(), mapView.when()]).then(() => {
      if (cancelled) return;

      // One-time initial alignment so both views start in the same place.
      if (sceneView.viewpoint) {
        mapView.viewpoint = sceneView.viewpoint.clone();
      }

      const watchActive = (view: any, id: SyncSource) => {
        handles.push(
          reactiveUtils.watch(
            () => view.interacting || view.animation,
            (isActive: boolean) => {
              if (isActive) {
                activeRef.current = id;
              }
            }
          )
        );
      };

      const watchViewpoint = (view: any, id: SyncSource, other: any) => {
        handles.push(
          reactiveUtils.watch(
            () => view.viewpoint,
            (viewpoint: any) => {
              // Only the view currently "in control" pushes its viewpoint
              // to the other one. Since we assign `.viewpoint` directly
              // (not `.goTo`), this does NOT trigger `.animation` on the
              // target — so there is no ping-pong back to the source.
              if (activeRef.current === id && viewpoint) {
                other.viewpoint = viewpoint.clone();
              }
            }
          )
        );
      };

      watchActive(sceneView, "scene");
      watchActive(mapView, "map");
      watchViewpoint(sceneView, "scene", mapView);
      watchViewpoint(mapView, "map", sceneView);
    });

    return () => {
      cancelled = true;
      handles.forEach((h) => h?.remove?.());
    };
  }, [sceneView, mapView]);

  return null;
});