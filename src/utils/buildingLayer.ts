import type Map from "@arcgis/core/Map.js";
import type BuildingSceneLayer from "@arcgis/core/layers/BuildingSceneLayer.js";
import type BuildingComponentSublayer from "@arcgis/core/layers/buildingSublayers/BuildingComponentSublayer.js";
import type Extent from "@arcgis/core/geometry/Extent.js";

/**
 * Busca la primera BuildingSceneLayer cargada en el mapa de la escena.
 * Recorre `map.allLayers` por tipo, así funciona con cualquier WebScene
 * que tenga una capa BIM, sin importar su id en config.
 */
export function findBuildingSceneLayer(map: Map): BuildingSceneLayer | null {
  const layer = map.allLayers.find((l) => l.type === "building-scene");
  return (layer as BuildingSceneLayer) ?? null;
}

/**
 * Devuelve solo las sublayers de tipo "building-component" (las que tienen
 * datos consultables), ignorando los grupos que solo organizan disciplinas.
 */
export function getComponentSublayers(
  layer: BuildingSceneLayer
): BuildingComponentSublayer[] {
  return layer.allSublayers
    .filter((s) => s.type === "building-component")
    .toArray() as BuildingComponentSublayer[];
}

/**
 * Obtiene la capa consultable (`associatedLayer`) de una sublayer de
 * componentes. Es un SceneLayer/FeatureLayer interno donde viven los
 * atributos y la geometría. Devuelve null si no está disponible.
 */
async function getQueryableLayer(sublayer: BuildingComponentSublayer): Promise<any | null> {
  try {
    await sublayer.load();
    const associated = (sublayer as any).associatedLayer;
    if (!associated) return null;
    await associated.load();
    return associated;
  } catch {
    return null;
  }
}

/**
 * Recorre las sublayers dadas y devuelve los valores distintos del primer
 * campo que responda (p.ej. el nivel/piso). No hardcodea en qué disciplina
 * vive el atributo. Si ninguna sublayer tiene el campo, devuelve [].
 */
export async function getDistinctFieldValues(
  sublayers: BuildingComponentSublayer[],
  fieldName: string
): Promise<string[]> {
  for (const sublayer of sublayers) {
    const layer = await getQueryableLayer(sublayer);
    if (!layer || typeof layer.queryFeatures !== "function") continue;

    // Verifica que el campo exista en esta capa antes de consultarlo.
    const hasField = (layer.fields ?? []).some(
      (f: any) => String(f?.name ?? "").toLowerCase() === fieldName.toLowerCase()
    );
    if (!hasField) continue;

    try {
      const query = layer.createQuery();
      query.outFields = [fieldName];
      query.returnDistinctValues = true;
      query.orderByFields = [fieldName];
      query.returnGeometry = false;
      query.where = "1=1";

      const result = await layer.queryFeatures(query);
      const values = result.features
        .map((f: any) => f.attributes[fieldName])
        .filter((v: any): v is string => v !== null && v !== undefined && v !== "")
        .map((v: any) => String(v));

      if (values.length) return values;
    } catch {
      continue;
    }
  }
  return [];
}

/**
 * Consulta TODAS las sublayers por campo = valor (paredes, puertas, mobiliario,
 * equipos... del piso/habitación seleccionado) y devuelve el extent que
 * envuelve todas las features. Une resultados de varias disciplinas porque un
 * piso casi siempre está compuesto por elementos de más de una.
 */
export async function getExtentAcrossSublayers(
  sublayers: BuildingComponentSublayer[],
  fieldName: string,
  value: string
): Promise<Extent | null> {
  let extent: Extent | null = null;

  for (const sublayer of sublayers) {
    const layer = await getQueryableLayer(sublayer);
    if (!layer || typeof layer.queryFeatures !== "function") continue;

    const hasField = (layer.fields ?? []).some(
      (f: any) => String(f?.name ?? "").toLowerCase() === fieldName.toLowerCase()
    );
    if (!hasField) continue;

    try {
      // queryExtent es más eficiente que traer geometrías si la capa lo soporta.
      if (typeof layer.queryExtent === "function") {
        const query = layer.createQuery();
        query.where = `${fieldName} = '${value.replace(/'/g, "''")}'`;
        const { extent: qExtent } = await layer.queryExtent(query);
        if (qExtent) {
          extent = extent ? extent.union(qExtent) : qExtent.clone();
        }
        continue;
      }

      // Fallback: traer geometrías y unir sus extents.
      const query = layer.createQuery();
      query.where = `${fieldName} = '${value.replace(/'/g, "''")}'`;
      query.returnGeometry = true;
      query.outFields = [fieldName];

      const result = await layer.queryFeatures(query);
      for (const feature of result.features) {
        const fe = feature.geometry?.extent;
        if (!fe) continue;
        extent = extent ? extent.union(fe) : fe.clone();
      }
    } catch {
      continue;
    }
  }

  return extent;
}

/**
 * Cuenta features que cumplan campo = valor a través de todas las sublayers.
 * Útil para "¿cuántos elementos/activos hay en este piso?".
 */
export async function countAcrossSublayers(
  sublayers: BuildingComponentSublayer[],
  fieldName: string,
  value: string
): Promise<number> {
  let total = 0;

  for (const sublayer of sublayers) {
    const layer = await getQueryableLayer(sublayer);
    if (!layer || typeof layer.queryFeatureCount !== "function") continue;

    const hasField = (layer.fields ?? []).some(
      (f: any) => String(f?.name ?? "").toLowerCase() === fieldName.toLowerCase()
    );
    if (!hasField) continue;

    try {
      const query = layer.createQuery();
      query.where = `${fieldName} = '${value.replace(/'/g, "''")}'`;
      total += await layer.queryFeatureCount(query);
    } catch {
      continue;
    }
  }

  return total;
}