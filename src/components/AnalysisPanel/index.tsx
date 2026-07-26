import React, { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import ViewshedAnalysis from "@arcgis/core/analysis/ViewshedAnalysis";
import state from "../../stores/state";
import styles from "./AnalysisPanel.module.css";

import "@esri/calcite-components/components/calcite-panel";
import "@arcgis/map-components/components/arcgis-line-of-sight";

interface AnalysisPanelProps {
  sceneId?: string;
}

export const AnalysisPanel: React.FC<AnalysisPanelProps> = observer(({ sceneId = "main-scene" }) => {
  const sceneView = state.getView("scene");
  const viewshedAnalysisRef = useRef<ViewshedAnalysis | null>(null);
  const placeAbortRef = useRef<AbortController | null>(null);
  const [isPlacing, setIsPlacing] = useState(false);

  const ensureViewshedAnalysis = () => {
    if (!sceneView) return null;
    let analysis = viewshedAnalysisRef.current;
    if (!analysis) {
      analysis = new ViewshedAnalysis();
      viewshedAnalysisRef.current = analysis;
      sceneView.analyses.add(analysis);
    } else if (!sceneView.analyses.includes(analysis)) {
      sceneView.analyses.add(analysis);
    }
    return analysis;
  };

  const handlePlaceViewshed = async () => {
    if (!sceneView || isPlacing) return;
    const analysis = ensureViewshedAnalysis();
    if (!analysis) return;

    try {
      const analysisView: any = await sceneView.whenAnalysisView(analysis);
      const controller = new AbortController();
      placeAbortRef.current = controller;
      setIsPlacing(true);
      await analysisView.place({ signal: controller.signal });
    } catch (error: any) {
      if (error?.name !== "AbortError") {
        console.error("Unable to place viewshed.", error);
      }
    } finally {
      placeAbortRef.current = null;
      setIsPlacing(false);
    }
  };

  const handleCancelPlacement = () => {
    placeAbortRef.current?.abort();
  };

  const handleClearViewsheds = () => {
    const analysis = viewshedAnalysisRef.current;
    if (!analysis) return;
    analysis.viewsheds.removeAll();
  };

  useEffect(() => {
    return () => {
      placeAbortRef.current?.abort();
      const analysis = viewshedAnalysisRef.current;
      if (analysis && sceneView && sceneView.analyses?.includes(analysis)) {
        sceneView.analyses.remove(analysis);
      }
      viewshedAnalysisRef.current = null;
    };
  }, [sceneView]);

  return (
    <div className={styles.container}>
      <calcite-panel className={styles.panel} heading="Analysis">
        <div className={styles.body}>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Line of Sight</div>
            <div className={styles.sectionBody}>
              <arcgis-line-of-sight reference-element={sceneId}></arcgis-line-of-sight>
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Viewshed</div>
            <div className={styles.sectionBody}>
              <div className={styles.viewshedActions}>
                {!isPlacing ? (
                  <button
                    type="button"
                    className={styles.button}
                    onClick={handlePlaceViewshed}
                    disabled={!sceneView}
                  >
                    Add Viewshed
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.button}
                    onClick={handleCancelPlacement}
                  >
                    Cancel Placement
                  </button>
                )}
                <button
                  type="button"
                  className={styles.button}
                  onClick={handleClearViewsheds}
                  disabled={!viewshedAnalysisRef.current}
                >
                  Clear
                </button>
              </div>
              <span className={styles.hint}>
                {isPlacing
                  ? "Click in the scene to place the observer, then click again to set direction."
                  : "Add a viewshed and click in the scene to place it."}
              </span>
            </div>
          </div>
        </div>
      </calcite-panel>
    </div>
  );
});
