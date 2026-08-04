import React, { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import Polygon from "@arcgis/core/geometry/Polygon";
import Collection from "@arcgis/core/core/Collection";
import FocusArea from "@arcgis/core/effects/FocusArea";
import state from "../../stores/state";
import assistantStore from "../../stores/assistant";
import styles from "./FocusAreaButton.module.css";

// Parámetros calibrados del recuadro de enfoque sobre el BIM.
const FOCUS_ANGLE_DEG = 32.5;   // orientación del edificio
const FOCUS_MARGIN_M = -10;   // holgura alrededor del edificio (negativo = más ceñido)

export const FocusAreaButton: React.FC = observer(() => {
  const sceneView = state.getView("scene");
  const focusAreaRef = useRef<any>(null);
  const extentRef = useRef<any>(null);
  const [active, setActive] = useState(false);

  const getFocusAreas = (): any => {
    const el = document.querySelector("arcgis-scene") as any;
    return el?.focusAreas ?? null;
  };

  const findBimExtent = async () => {
    if (extentRef.current) return extentRef.current;
    const view = sceneView;
    if (!view) return null;
    await view.when?.();
    const layers = view.map?.allLayers?.toArray?.() ?? [];
    let target: any = layers.find((l: any) => l?.type === "building-scene") ?? null;
    if (!target) {
      const sceneLayers = layers.filter((l: any) => l?.type === "scene");
      for (const l of sceneLayers) { try { await l?.load?.(); } catch { /* */ } }
      sceneLayers.sort((a: any, b: any) => {
        const ea = a.fullExtent, eb = b.fullExtent;
        if (!ea || !eb) return 0;
        return (ea.xmax - ea.xmin) * (ea.ymax - ea.ymin) - (eb.xmax - eb.xmin) * (eb.ymax - eb.ymin);
      });
      target = sceneLayers[0] ?? null;
    }
    if (!target) return null;
    try { await target?.load?.(); } catch { /* */ }
    extentRef.current = target.fullExtent;
    return extentRef.current;
  };

  const buildGeometry = (e: any): Polygon => {
    const cx = (e.xmin + e.xmax) / 2;
    const cy = (e.ymin + e.ymax) / 2;
    const hx = (e.xmax - e.xmin) / 2 + FOCUS_MARGIN_M;
    const hy = (e.ymax - e.ymin) / 2 + FOCUS_MARGIN_M;
    const rad = (FOCUS_ANGLE_DEG * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const corners = [
      [-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy],
    ].map(([lx, ly]) => [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos]);
    corners.push(corners[0]);
    return new Polygon({
      spatialReference: e.spatialReference ?? { wkid: 102100, latestWkid: 3857 },
      rings: [corners],
    });
  };

  useEffect(() => {
    return () => {
      const focusAreas = getFocusAreas();
      if (focusAreas && focusAreaRef.current) {
        focusAreas.areas?.remove(focusAreaRef.current);
        focusAreaRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const cmd = assistantStore.command;
    if (!cmd || cmd.tool !== "enfocar_campus") return;
    const target = Boolean(cmd.args?.activo);
    if (target !== active) {
      void toggle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantStore.command?.id]);

  const toggle = async () => {
    const focusAreas = getFocusAreas();
    const e = await findBimExtent();
    if (!focusAreas || !e) {
      console.warn("[FocusArea] No se pudo enfocar (falta focusAreas o extent del BIM).");
      return;
    }

    if (!focusAreaRef.current) {
      const fa = new FocusArea({
        title: "Campus UPS",
        id: "focusarea-campus",
        geometries: new Collection([buildGeometry(e)]),
      });
      focusAreaRef.current = fa;
      focusAreas.areas.add(fa);
      focusAreas.style = "bright";
    }

    const next = !active;
    focusAreaRef.current.enabled = next;
    setActive(next);
  };

  return (
    <div className={styles.group}>
      <button
        type="button"
        className={`${styles.fab} ${active ? styles.active : ""}`}
        onClick={toggle}
        disabled={!sceneView}
        title="Enfocar el edificio y atenuar el entorno"
      >
        {active ? "Quitar enfoque" : "Enfocar campus"}
      </button>
    </div>
  );
});