import React, { useState } from "react";
import "@esri/calcite-components/dist/components/calcite-label";
import "@esri/calcite-components/dist/components/calcite-switch";

import styles from "./DarkModeSwitch.module.css";

interface DarkModeSwitchProps {
  slot?: string;
}

export const DarkModeSwitch: React.FC<DarkModeSwitchProps> = ({ slot = "content-end" }) => {
  const [darkMode, setDarkMode] = useState(false);

  const handleSwitchChange = (event: any) => {
    const checked = event.target.checked;
    setDarkMode(checked);
    document.body.classList.toggle("calcite-mode-dark", checked);
    document.body.classList.toggle("calcite-mode-light", !checked);

    // force widgets to switch to the theme
    const widgets = document.getElementsByClassName("esri-ui");

    if (widgets && widgets.length > 0){
      for (let i = 0; i < widgets.length; i++) {
        widgets.item(i).classList.toggle("calcite-mode-dark", checked);
        widgets.item(i).classList.toggle("calcite-mode-light", !checked);
      }
    }

    // Dynamically switch ArcGIS Maps SDK theme
    const themeLink = document.getElementById("arcgis-maps-sdk-theme") as HTMLLinkElement;
    if (themeLink) {
      themeLink.href = checked
        ? "https://js.arcgis.com/4.32/esri/themes/dark/main.css"
        : "https://js.arcgis.com/4.32/esri/themes/light/main.css";
    }
  };

  return (
    <div slot={slot}>
      <calcite-label scale="l" layout="inline" className={styles.labelWrapper}>
        🌙
        <calcite-switch
          checked={darkMode}
          oncalciteSwitchChange={handleSwitchChange}
        ></calcite-switch>
      </calcite-label>
    </div>
  );
};