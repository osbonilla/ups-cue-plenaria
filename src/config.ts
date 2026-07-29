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
  // ⚠️ CONSERVA AQUÍ EL web-scene-id QUE YA TE FUNCIONA ("Copy of Bloque A UPS").
  // Si tu copia local tiene otro valor distinto a este, NO lo sobrescribas con
  // el de este archivo: los cortes de Pisos/Secciones están calibrados a esa escena.
  'web-scene-id': 'bd4a0bcbd92c41c392df28075d682d69',
  'web-map-id': 'c9ec7df8b356464bbe51c67aab3abb0f'
};

export type AssetLayerFields = {
  objectId: string;
  nameField?: string;
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

// --- ACTIVOS: Puntos de interés del Bloque A (Enterprise propio) ---
// ✔ VERIFICADO contra el servicio (28-jul-2026): única capa "PuntosInteres_BA"
//   (índice 23, puntos con Z, esquema de Units de ArcGIS Indoors). Se deja la
//   URL en la RAÍZ del FeatureServer a propósito: el SDK toma la primera capa
//   del servicio (la 23) y el matching por URL del resto de la app (que
//   compara raíces) sigue funcionando sin cambios.
// El panel ACTIVOS agrupa por `assetType` (mismo campo del renderer del
// servicio), etiqueta cada punto con `nameField`, describe con
// `floorLabel` + `cardinal`, y `levelId` trae el LEVEL_ID REAL de Indoors:
// listo para el cruce con Pisos (Fase 2) contra el layer Levels de la escena.
export const assetLayerConfig: AssetLayerConfig = {
  itemId: "965874466199406c92066a4bd0021b09", // Service Item Id del ítem en el portal Enterprise
  title: "Puntos de Interés UPS",
  serviceUrl:
    "https://arcgis.esri.co/server/rest/services/Hosted/UPS_Bloque_A_WSL9/FeatureServer",
  fields: {
    objectId: "objectid",        // OID real del servicio alojado
    nameField: "name",           // Display Field, NO nulo: etiqueta principal del punto
    assetType: "category_type",  // agrupación (ADMINISTRATIVO, AULAS, BIBLIOTECA, ...)
    floorLabel: "name_long",     // descripción secundaria (puede venir vacía)
    levelId: "level_id",         // LEVEL_ID de Indoors (cruce con Pisos, Fase 2)
    cardinal: "use_type",        // descriptor adicional (puede venir vacío)
  },
};

// --- IMAGERY: Mapillary global street-level imagery (beta) — Living Atlas ---
// Ítem de ArcGIS Online (grupo con 2 capas: "Mapillary Global Coverage",
// vector tile de cobertura, y "Mapillary Global Oriented Imagery", la capa
// de imágenes orientadas que consume el visor del panel IMAGERY).
export const orientedImageryConfig = {
  portalUrl: "https://www.arcgis.com",
  itemId: "e2274944df6f402dbe1c4d1b261f0e11",
  title: "Mapillary Street-Level (Living Atlas)",
};

// --- ESCENA 3D EXTERNA: pestaña de solo visualización, de OTRO portal ---
// Por defecto apunta a una escena pública de Esri en ArcGIS Online (la del
// sample "Load a basic web scene"). Reemplaza `websceneItemId` (y si aplica
// `portalUrl`) por la escena que quieras mostrar. Debe estar compartida
// públicamente, porque la app no tiene login interactivo contra ese portal.
export const secondarySceneConfig = {
  label: "ESCENA 3D",
  panelHeading: "Escena 3D",
  portalUrl: "https://esrimarketing.maps.arcgis.com/",
  websceneItemId: "3b08094bf6194046b98bf55458300e15",
};

// --- BOOKMARKS PREDETERMINADOS (se inyectan al cargar la escena) ---
// Cada entrada crea un "slide" en el panel BOOKMARKS con esa cámara.
// CÓMO CAPTURAR UNA CÁMARA: con la app abierta, acomoda la vista y ejecuta en
// la consola del navegador:
//     copy(JSON.stringify(__view.camera.toJSON()))
// (…__view lo expone el listener temporal de calibración). Pega el resultado
// como valor de `camera`. `thumbnailUrl` es opcional: sin él se genera una
// miniatura automática con la inicial del título.
export type DefaultBookmark = {
  id: string;
  title: string;
  camera: any; // JSON de __esri.Camera (position + heading + tilt)
  thumbnailUrl?: string;
};

export const defaultBookmarks: DefaultBookmark[] = [
  {
    id: "bm-vista-general",
    title: "Vista general del campus",
    camera: {
      position: {
        spatialReference: { latestWkid: 3857, wkid: 102100 },
        x: -8737600,
        y: -23480,
        z: 160,
      },
      heading: 40,
      tilt: 68,
    },
  },
];

export const portalUrl = 'https://arcgis.esri.co/portal';

export const applicationTitle = "Infraestructura Viva";
export const applicationDescription = "Gemelo Digital · Campus UPS-Q";

export const applicationId = 'J67XjhOQ7O45mV0u';

export const mapillaryConfig = {
  accessToken: "MLY|27764881406485371|6107f680e3728551797c19097e433398",
};