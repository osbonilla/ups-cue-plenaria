import React from "react";
import { observer } from "mobx-react-lite";
import styles from "./InlineNavToggles.module.css";
import navigationState from "../../stores/navigation";
import { secondarySceneConfig } from "../../config";

interface InlineNavTogglesProps {
  slot?: string;
}

export const InlineNavToggles: React.FC<InlineNavTogglesProps> = observer(({ slot = "content-center" }) => {
  const { toggles, viewMode } = navigationState;
  const isMapOnly = viewMode === "map-only";

  const handleFloorsToggle = () => {
    navigationState.toggle("floors");
    if (navigationState.toggles.floors) {
      navigationState.setToggle("sections", false);
    }
  };

  const handleSectionsToggle = () => {
    navigationState.toggle("sections");
    if (navigationState.toggles.sections) {
      navigationState.setToggle("floors", false);
    }
  };

  return (
    <div slot={slot} className={styles.container}>
      <button
        type="button"
        className={`${styles.item} ${toggles.floors ? styles.selected : ""}`}
        onClick={handleFloorsToggle}
        aria-pressed={toggles.floors}
      >
        PISOS
      </button>
      <span className={styles.separator} aria-hidden="true">
        |
      </span>
      <button
        type="button"
        className={`${styles.item} ${toggles.assets ? styles.selected : ""}`}
        onClick={() => navigationState.toggle("assets")}
        aria-pressed={toggles.assets}
      >
        ACTIVOS
      </button>
      <span className={styles.separator} aria-hidden="true">
        |
      </span>
      <button
        type="button"
        className={`${styles.item} ${toggles.sections ? styles.selected : ""}`}
        onClick={handleSectionsToggle}
        aria-pressed={toggles.sections}
      >
        SECCIONES
      </button>
      <span className={styles.separator} aria-hidden="true">
        |
      </span>
      <button
        type="button"
        className={`${styles.item} ${toggles.bookmarks ? styles.selected : ""}`}
        onClick={() => navigationState.toggle("bookmarks")}
        aria-pressed={toggles.bookmarks}
      >
        BOOKMARKS
      </button>
      <span className={styles.separator} aria-hidden="true">
        |
      </span>
      <button
        type="button"
        className={`${styles.item} ${toggles.analysis ? styles.selected : ""}`}
        onClick={() => navigationState.toggle("analysis")}
        aria-pressed={toggles.analysis}
      >
        ANÁLISIS
      </button>
      <span className={styles.separator} aria-hidden="true">
        |
      </span>
      <button
        type="button"
        className={`${styles.item} ${toggles.imagery ? styles.selected : ""}`}
        onClick={() => navigationState.toggle("imagery")}
        aria-pressed={toggles.imagery}
      >
        IMAGERY
      </button>
      <span className={styles.separator} aria-hidden="true">
        |
      </span>
      <button
        type="button"
        className={`${styles.item} ${toggles.scene2 ? styles.selected : ""}`}
        onClick={() => navigationState.toggle("scene2")}
        aria-pressed={toggles.scene2}
      >
        {secondarySceneConfig.label}
      </button>
      <span className={styles.separator} aria-hidden="true">
        |
      </span>
      <button
        type="button"
        className={`${styles.item} ${toggles.basemap && !isMapOnly ? styles.selected : ""}`}
        onClick={() => navigationState.toggle("basemap")}
        aria-pressed={toggles.basemap && !isMapOnly}
      >
        BASEMAP
      </button>
    </div>
  );
});
