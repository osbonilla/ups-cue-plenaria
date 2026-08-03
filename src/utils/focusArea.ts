import type SceneView from "@arcgis/core/views/SceneView.js";
import type Extent from "@arcgis/core/geometry/Extent.js";
import FocusArea from "@arcgis/core/effects/FocusArea.js";
import Polygon from "@arcgis/core/geometry/Polygon.js";
import Collection from "@arcgis/core/core/Collection.js";

const FOCUS_AREA_ID = "digital-twin-focus-area";

// Margen alrededor del extent consultado, para que el área de foco no
// recorte justo en el borde de las features seleccionadas. Ajustable.
const EXTENT_BUFFER_FACTOR = 1.15;

function extentToPolygon(extent: Extent): Polygon {
  // FocusArea.geometries solo acepta Polygon (no Extent), y expand()
  // muta el objeto sobre el que se llama, por eso se clona antes.
  const buffered = extent.clone().expand(EXTENT_BUFFER_FACTOR);
  return new Polygon({
    spatialReference: buffered.spatialReference,
    rings: [
      [
        [buffered.xmin, buffered.ymin],
        [buffered.xmax, buffered.ymin],
        [buffered.xmax, buffered.ymax],
        [buffered.xmin, buffered.ymax],
        [buffered.xmin, buffered.ymin],
      ],
    ],
  });
}

/**
 * Aplica (o actualiza) el Focus Area de la escena sobre un extent dado.
 * Usa un id fijo para reemplazar el área anterior en vez de acumular un
 * FocusArea nuevo cada vez que el usuario cambia de piso/habitación.
 */
export function applyFocusArea(
  view: SceneView,
  extent: Extent,
  style: "dark" | "bright" = "dark"
): void {
  const polygon = extentToPolygon(extent);
  const existing = view.focusAreas.areas.find((a) => a.id === FOCUS_AREA_ID);

  if (existing) {
    existing.geometries = new Collection([polygon]);
    existing.enabled = true;
  } else {
    view.focusAreas.areas.add(
      new FocusArea({
        id: FOCUS_AREA_ID,
        title: "Selección del gemelo digital",
        geometries: new Collection([polygon]),
      })
    );
  }

  view.focusAreas.style = style;
}

/** Desactiva el Focus Area actual sin eliminar su definición. */
export function clearFocusArea(view: SceneView): void {
  const existing = view.focusAreas.areas.find((a) => a.id === FOCUS_AREA_ID);
  if (existing) existing.enabled = false;
}
