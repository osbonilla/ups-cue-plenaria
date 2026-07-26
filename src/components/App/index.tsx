/* Copyright 2025 Esri
 *
 * Licensed under the Apache License Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import React from 'react';
import { observer } from 'mobx-react-lite';
import { ErrorAlert } from '../ErrorAlert';
import { Identity } from '../Identity';
import { SceneView } from '../SceneView'
import { MapView } from '../MapView';
import { Navigation } from '../Navigation';
import './App.css';
import { SceneToolsHost } from '../SceneToolsHost';
import navigationState from '../../stores/navigation';
import { ViewSync } from '../ViewSync';
import { LayersPanel } from '../LayersPanel';

import "@esri/calcite-components/components/calcite-shell";
import { Bookmarks } from '../Bookmarks';

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
        <LayersPanel></LayersPanel>
      </div>
      <Bookmarks></Bookmarks>
      <Identity></Identity>
      <ErrorAlert></ErrorAlert>
    </calcite-shell>  
    </>
  );
});

export default App;
