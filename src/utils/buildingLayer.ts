import type Map from "@arcgis/core/Map.js";
import type BuildingSceneLayer from "@arcgis/core/layers/BuildingSceneLayer.js";
import type BuildingComponentSublayer from "@arcgis/core/layers/buildingSublayers/BuildingComponentSublayer.js";
import type Extent from "@arcgis/core/geometry/Extent.js";
import Query from "@arcgis/core/rest/support/Query.js";

/**
 * Busca la primera BuildingSceneLayer cargada en el mapa de la escena.
 * No asume un layer id fijo: recorre `map.allLayers` por tipo, así funciona
 * con cualquier WebScene que tenga una capa BIM, sin importar cuál esté
 * configurada en `config.ts`.
 */
export function findBuildingSceneLayer(map: Map): BuildingSceneLayer | null {
  const layer = map.allLayers.find((l) => l.type === "building-scene");
  return (layer as BuildingSceneLayer) ?? null;
}

/**
 * Devuelve solo las sublayers de tipo "component" (las que tienen datos
 * consultables) de una BuildingSceneLayer, ignorando los grupos que solo
 * organizan disciplinas (Architectural, Structural, MEP, etc.).
 */
export function getComponentSublayers(
  layer: BuildingSceneLayer
): BuildingComponentSublayer[] {
  return layer.allSublayers
    .filter((s) => s.sublayerType === "component")
    .toArray() as BuildingComponentSublayer[];
}

/**
 * Recorre las sublayers dadas y devuelve los valores distintos del primer
 * campo que responda (p.ej. el nivel/piso). Evita hardcodear en qué
 * disciplina vive el atributo, ya que varía según cómo se publicó el
 * modelo BIM. Si ninguna sublayer tiene el campo, devuelve [].
 */
export async function getDistinctFieldValues(
  sublayers: BuildingComponentSublayer[],
  fieldName: string
): Promise<string[]> {
  for (const sublayer of sublayers) {
    try {
      await sublayer.load();
      const result = await sublayer.queryFeatures(
        new Query({
          outFields: [fieldName],
          returnDistinctValues: true,
          orderByFields: [fieldName],
          returnGeometry: false,
        })
      );
      const values = result.features
        .map((f) => f.attributes[fieldName])
        .filter(
          (v): v is string => v !== null && v !== undefined && v !== ""
        );
      if (values.length) return values;
    } catch {
      // Esta sublayer no tiene el campo o no es consultable: se ignora
      // y se intenta con la siguiente.
      continue;
    }
  }
  return [];
}

/**
 * Consulta TODAS las sublayers dadas por campo = valor (paredes, puertas,
 * mobiliario, equipos... del piso/habitación/laboratorio seleccionado) y
 * devuelve el extent que envuelve a todas las features encontradas.
 * Une resultados de varias sublayers porque un piso o una habitación casi
 * siempre está compuesto por elementos de más de una disciplina.
 */
export async function getExtentAcrossSublayers(
  sublayers: BuildingComponentSublayer[],
  fieldName: string,
  value: string
): Promise<Extent | null> {
  let extent: Extent | null = null;

  for (const sublayer of sublayers) {
    try {
      await sublayer.load();
      const result = await sublayer.queryFeatures(
        new Query({
          where: `${fieldName} = '${value}'`,
          returnGeometry: true,
          outFields: [fieldName],
        })
      );
      for (const feature of result.features) {
        const featureExtent = feature.geometry?.extent;
        if (!featureExtent) continue;
        extent = extent ? extent.union(featureExtent) : featureExtent.clone();
      }
    } catch {
      continue;
    }
  }

  return extent;
}
