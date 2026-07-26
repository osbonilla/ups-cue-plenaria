import React, { useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import state from "../../stores/state";
import navigationState from "../../stores/navigation";
import styles from "./LayersPanel.module.css";

import "@esri/calcite-components/components/calcite-panel";
import "@esri/calcite-components/components/calcite-label";
import "@esri/calcite-components/components/calcite-switch";

const BUILDINGS_LAYER_TITLE = "Esri 3D Buildings";

const findLayerByTitle = (view: any, title: string) => {
  if (!view?.map) return null;
  return view.map.allLayers.find((layer: any) => layer?.title === title) ?? null;
};

export const LayersPanel: React.FC = observer(() => {
  const sceneView = state.getView("scene");
  const sceneLoaded = state.viewLoadedById.scene;
  const isMapOnly = navigationState.viewMode === "map-only";
  const [buildingsLayer, setBuildingsLayer] = useState<any | null>(null);

  const [buildingsVisible, setBuildingsVisible] = useState(false);

  useEffect(() => {
    if (!sceneLoaded || !sceneView) {
      setBuildingsLayer(null);
      return;
    }

    setBuildingsLayer(findLayerByTitle(sceneView, BUILDINGS_LAYER_TITLE));

  }, [sceneLoaded, sceneView]);

  useEffect(() => {
    if (buildingsLayer) {
      setBuildingsVisible(!!buildingsLayer.visible);
    }
  }, [buildingsLayer]);

  const handleBuildingsToggle = (event: any) => {
    if (!buildingsLayer) return;
    const checked = !!event.target.checked;
    setBuildingsVisible(checked);
    buildingsLayer.visible = checked;
  };

  if (isMapOnly) {
    return null;
  }

  return (
    <div className={styles.container}>
      <calcite-panel className={styles.panel}>
        <div className={styles.body}>
          <calcite-label layout="inline-space-between" className={styles.row}>
            Buildings 3D
            <calcite-switch
              checked={buildingsVisible}
              disabled={!buildingsLayer || undefined}
              oncalciteSwitchChange={handleBuildingsToggle}
            ></calcite-switch>
          </calcite-label>
        </div>
      </calcite-panel>
    </div>
  );
});
