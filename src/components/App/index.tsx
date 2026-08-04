import React from 'react';
import { observer } from 'mobx-react-lite';
import { ErrorAlert } from '../ErrorAlert';
import { Identity } from '../Identity';
import { SceneView } from '../SceneView'
import { MapView } from '../MapView';
import { Navigation } from '../Navigation';
import { AssistantPanel } from '../AssistantPanel';
import { FocusAreaButton } from '../FocusAreaButton';
import './App.css';
import { SceneToolsHost } from '../SceneToolsHost';
import navigationState from '../../stores/navigation';
import { ViewSync } from '../ViewSync';
import { AssistantExecutor } from '../AssistantExecutor';

        

import "@esri/calcite-components/components/calcite-shell";
import { Bookmarks } from '../Bookmarks';
import { SecondaryScenePanel } from '../SecondaryScenePanel';

const sceneId = "main-scene";
const mapId = "main-map";

const App = observer(function App() {
  const isSplit = navigationState.viewMode === "split";
  const isSceneOnly = navigationState.viewMode === "scene-only";
  const isMapOnly = navigationState.viewMode === "map-only";

  const layoutClassName = isSplit
    ? "view-layout split"
    : isMapOnly
      ? "view-layout map-only"
      : "view-layout scene-only";

  return (
    <>
    <calcite-shell>
      <Navigation></Navigation>
      <ViewSync></ViewSync>
      <div className={layoutClassName}>
        <div className="view-pane scene-pane" aria-hidden={isMapOnly}>
          <SceneView sceneId={sceneId}></SceneView>
        </div>
        <div className="view-pane map-pane" aria-hidden={isSceneOnly}>
          <MapView mapId={mapId} hidden={isSceneOnly}></MapView>
        </div>
        <SceneToolsHost sceneId={sceneId}></SceneToolsHost>
        <FocusAreaButton></FocusAreaButton>
        <AssistantPanel></AssistantPanel>
      </div>
      <Bookmarks></Bookmarks>
      <SecondaryScenePanel></SecondaryScenePanel>
      <Identity></Identity>
      <ErrorAlert></ErrorAlert>
      <FocusAreaButton></FocusAreaButton>
      <AssistantPanel></AssistantPanel>
      <AssistantExecutor></AssistantExecutor>
    </calcite-shell>
    </>
  );
});

export default App;