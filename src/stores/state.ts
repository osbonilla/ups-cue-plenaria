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

import { action, makeObservable, observable } from "mobx";

export interface Error {
    name: string | null;
    message: string | null;
}

export type ViewId = "scene" | "map";
export type LayoutMode = "scene-only" | "map-only" | "split";

export interface ViewRegistry {
    scene: any | null;
    map: any | null;
}

class State {
    viewLoadedById: Record<ViewId, boolean> = {
        scene: false,
        map: false,
    }
    error: Error | null = null
    views: ViewRegistry = {
        scene: null,
        map: null,
    }
    activeViewId: ViewId = "scene"
    layoutMode: LayoutMode = "scene-only"

    constructor() {
        makeObservable(this, {
            viewLoadedById: observable,
            setViewLoadedById: action,
            error: observable,
            setError: action,
            views: observable,
            registerView: action,
            unregisterView: action,
            activeViewId: observable,
            setActiveViewId: action,
            layoutMode: observable,
            setLayoutMode: action
        })
    }

    setViewLoadedById(viewId: ViewId, isLoaded: boolean) {
        this.viewLoadedById = {
            ...this.viewLoadedById,
            [viewId]: isLoaded,
        };
    }

    setError({ name, message }: Error) {
        if (name && message) {
            this.error = {
                name, message
            }
        } else {
            this.error = null;
        }
    }

    registerView(viewId: ViewId, view: any) {
        this.views = {
            ...this.views,
            [viewId]: view,
        };
    }

    unregisterView(viewId: ViewId) {
        this.views = {
            ...this.views,
            [viewId]: null,
        };

        this.viewLoadedById = {
            ...this.viewLoadedById,
            [viewId]: false,
        };
    }

    setActiveViewId(viewId: ViewId) {
        this.activeViewId = viewId;
    }

    setLayoutMode(layoutMode: LayoutMode) {
        this.layoutMode = layoutMode;
    }

    getView(viewId: ViewId) {
        return this.views[viewId];
    }

}

const state = new State();
export default state;