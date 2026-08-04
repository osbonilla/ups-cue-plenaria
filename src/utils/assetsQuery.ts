import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

// Encuentra la capa de Activos (Puntos de Interés UPS) en la vista.
function findAssetsLayer(view: any): any | null {
  const layers = view?.map?.allLayers?.toArray?.() ?? [];
  return (
    layers.find((l: any) =>
      String(l.url || "").toLowerCase().includes("ups_bloque_a_wsl9"),
    ) ?? null
  );
}

let highlightLayerRef: GraphicsLayer | null = null;

function ensureHighlightLayer(view: any): GraphicsLayer {
  if (!highlightLayerRef) {
    highlightLayerRef = new GraphicsLayer({
      listMode: "hide",
      elevationInfo: { mode: "relative-to-scene" },
    });
    view.map?.add(highlightLayerRef);
  }
  return highlightLayerRef;
}

export type SearchResult = {
  count: number;
  names: string[];
  found: boolean;
};

// Busca por categoría (+ nombre opcional), resalta los puntos y vuela la cámara.
export async function buscarLugar(
  view: any,
  categoria: string,
  nombre?: string,
): Promise<SearchResult> {
  const layer = findAssetsLayer(view);
  if (!layer || !view) return { count: 0, names: [], found: false };

  await layer.load();

  const cat = categoria.replace(/'/g, "''");
  let where = `category_type = '${cat}'`;
  if (nombre && nombre.trim()) {
    const n = nombre.replace(/'/g, "''");
    where += ` AND name LIKE '%${n}%'`;
  }

  const q = layer.createQuery();
  q.where = where;
  q.outFields = ["name", "category_type", "level_id"];
  q.returnGeometry = true;

  const res = await layer.queryFeatures(q);
  const features = res.features ?? [];

  const hl = ensureHighlightLayer(view);
  hl.removeAll();

  if (!features.length) {
    return { count: 0, names: [], found: false };
  }

  // Símbolo de resaltado (cian brillante, elevado).
  const highlightSymbol = {
    type: "point-3d",
    symbolLayers: [
      {
        type: "icon",
        resource: { primitive: "circle" },
        material: { color: [0, 200, 255, 0.9] },
        outline: { color: [255, 255, 255, 1], size: 2 },
        size: 16,
      },
    ],
    verticalOffset: { screenLength: 30, maxWorldLength: 300 },
    callout: { type: "line", size: 2, color: [0, 200, 255, 1] },
  } as any;

  for (const f of features) {
    if (f.geometry) {
      hl.add(new Graphic({ geometry: f.geometry, symbol: highlightSymbol }));
    }
  }

  // Vuela la cámara para encuadrar los resultados.
  try {
    await view.goTo(
      { target: features.map((f: any) => f.geometry) },
      { duration: 1500, easing: "ease-in-out" },
    );
    // Un poco de tilt para verlo en 3D.
    await view.goTo({ tilt: 55 }, { duration: 800 });
  } catch {
    /* goTo puede fallar si la geometría es rara; ignorar */
  }

  return {
    count: features.length,
    names: features.slice(0, 8).map((f: any) => f.attributes.name),
    found: true,
  };
}

// Lista una categoría: cuántos hay + algunos nombres.
export async function listarLugares(view: any, categoria: string): Promise<SearchResult> {
  const layer = findAssetsLayer(view);
  if (!layer || !view) return { count: 0, names: [], found: false };

  await layer.load();
  const cat = categoria.replace(/'/g, "''");

  const count = await layer.queryFeatureCount({ where: `category_type = '${cat}'` });

  const q = layer.createQuery();
  q.where = `category_type = '${cat}'`;
  q.outFields = ["name"];
  q.returnGeometry = false;
  q.orderByFields = ["name"];
  q.num = 12;
  const res = await layer.queryFeatures(q);

  return {
    count,
    names: (res.features ?? []).map((f: any) => f.attributes.name),
    found: count > 0,
  };
}

// Limpia el resaltado.
export function limpiarResaltado(view: any) {
  if (highlightLayerRef) {
    highlightLayerRef.removeAll();
  }
}