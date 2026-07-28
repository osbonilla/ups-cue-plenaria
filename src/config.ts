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

export type MapConfig = {
  'web-map-id': string;
  basemap: string;
  center: {
    lon: number;
    lat: number;
  };
  popupDisabled: boolean;
  rotation: number;
  scale: number;
  zoom: number;
};

export const mapConfig = {
  'web-scene-id': 'bd4a0bcbd92c41c392df28075d682d69',
  'web-map-id': 'c9ec7df8b356464bbe51c67aab3abb0f'
};

export type AssetLayerFields = {
  objectId: string;
  assetType: string;
  floorLabel: string;
  levelId: string;
  cardinal: string;
};

export type AssetLayerConfig = {
  itemId: string;
  title: string;
  serviceUrl: string;
  fields: AssetLayerFields;
};

export const assetLayerConfig: AssetLayerConfig = {
  itemId: "d4a2ad23971b45e6b3db5785805ec407",
  title: "BC place firefighting features",
  serviceUrl:
    "https://services6.arcgis.com/oQnbmhWcCuy4gMUa/arcgis/rest/services/BCPlace__random_FireAssets65_wm_view/FeatureServer",
  fields: {
    objectId: "OBJECTID",
    assetType: "Fire_Assets",
    floorLabel: "Floor_Level",
    levelId: "LEVEL_ID",
    cardinal: "Cardinal",
  },
};

export const portalUrl = 'https://arcgis.esri.co/portal';

export const applicationTitle = "Infraestructura Viva";
export const applicationDescription = "Gemelo Digital de un campus universitario con modelos BIM, ArcGIS Maps SDK for JavaScript y visualización 3D.";

export const applicationId = 'J67XjhOQ7O45mV0u';