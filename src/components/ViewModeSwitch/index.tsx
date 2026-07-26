import React from "react";
import { observer } from "mobx-react-lite";
import navigationState from "../../stores/navigation";
import styles from "./ViewModeSwitch.module.css";
import "@esri/calcite-components/dist/components/calcite-segmented-control";
import "@esri/calcite-components/dist/components/calcite-segmented-control-item";

interface ViewModeSwitchProps {
  slot?: string;
}

export const ViewModeSwitch: React.FC<ViewModeSwitchProps> = observer(({ slot = "content-end" }) => {
  const { viewMode } = navigationState;

  const handleModeChange = (event: any) => {
    const nextMode = event?.target?.selectedItem?.value;

    if (nextMode === "scene-only" || nextMode === "split" || nextMode === "map-only") {
      navigationState.setViewMode(nextMode);
    }
  };

  return (
    <div slot={slot} className={styles.container} aria-label="View mode switch">
      <calcite-segmented-control
        scale="s"
        width="auto"
        oncalciteSegmentedControlChange={handleModeChange}
      >
        <calcite-segmented-control-item value="scene-only" checked={viewMode === "scene-only"}>
          3D
        </calcite-segmented-control-item>
        <calcite-segmented-control-item value="split" checked={viewMode === "split"}>
          Split
        </calcite-segmented-control-item>
        <calcite-segmented-control-item value="map-only" checked={viewMode === "map-only"}>
          2D
        </calcite-segmented-control-item>
      </calcite-segmented-control>
    </div>
  );
});
