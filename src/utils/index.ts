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

import PointSymbol3D from "@arcgis/core/symbols/PointSymbol3D";
import IconSymbol3DLayer from "@arcgis/core/symbols/IconSymbol3DLayer";

const fadeLayer = (layer: __esri.Layer) => {
    const opacity = parseFloat((layer.opacity + 0.02).toFixed(2));
    layer.opacity = opacity;
    if (layer.opacity < 1) {
        window.requestAnimationFrame(function () {
            fadeLayer(layer);
        });
    }
};
export function fadeIn(layer: __esri.Layer) {
    layer.opacity = 0;
    if (!layer.visible) {
        layer.visible = true;
    }
    fadeLayer(layer);
}

export const roundNumber = (number: number, digits: number) => {
    return Number(number.toFixed(digits))
}

export const formatNumber = (number: number) => {
    return new Intl.NumberFormat("en-US").format(number);
};

export const formatDate = (time: number) => {
    const date = new Date(time);
    return new Intl.DateTimeFormat("en-US").format(date);
}

export const toPoint3DIconSymbol = (sourceSymbol: any) => {
    if (!sourceSymbol) {
        return null;
    }

    if (sourceSymbol.type === "point-3d") {
        return typeof sourceSymbol.clone === "function" ? sourceSymbol.clone() : sourceSymbol;
    }

    if (sourceSymbol.type !== "picture-marker") {
        return typeof sourceSymbol.clone === "function" ? sourceSymbol.clone() : sourceSymbol;
    }

    const sizeCandidate = Number(sourceSymbol.size ?? sourceSymbol.width ?? sourceSymbol.height ?? 16);
    const size = Number.isFinite(sizeCandidate) ? sizeCandidate : 16;

    const iconLayer = new IconSymbol3DLayer({
        resource: { href: sourceSymbol.url },
        size,
    });

    return new PointSymbol3D({
        symbolLayers: [iconLayer],
    });
};