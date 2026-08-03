import { action, makeObservable, observable } from "mobx";
import state, { LayoutMode } from "./state";

export interface NavigationToggleState {
  assets: boolean;
  floors: boolean;
  sections: boolean;
  bookmarks: boolean;
  analysis: boolean;
  imagery: boolean;
  basemap: boolean;
  scene2: boolean;
  security: boolean;
}
type NavigationToggleKey = keyof NavigationToggleState;

class NavigationState {
  toggles: NavigationToggleState = {
    assets: false,
    floors: false,
    sections: false,
    bookmarks: false,
    analysis: false,
    imagery: false,
    basemap: false,
    scene2: false,
    security: false, 
  };
  viewMode: LayoutMode = "scene-only";

  constructor() {
    makeObservable(this, {
      toggles: observable,
      viewMode: observable,
      toggle: action,
      setToggle: action,
      setToggles: action,
      setViewMode: action,
    });
  }

  toggle(key: NavigationToggleKey) {
    this.toggles = {
      ...this.toggles,
      [key]: !this.toggles[key],
    };
  }

  setToggle(key: NavigationToggleKey, value: boolean) {
    this.toggles = {
      ...this.toggles,
      [key]: value,
    };
  }

  setToggles(next: NavigationToggleState) {
    this.toggles = next;
  }

  setViewMode(mode: LayoutMode) {
    this.viewMode = mode;
    state.setLayoutMode(mode);

    if (mode === "scene-only") {
      state.setActiveViewId("scene");
      return;
    }

    if (mode === "map-only") {
      state.setActiveViewId("map");
    }
  }
}

const navigationState = new NavigationState();

export type { NavigationToggleKey };
export default navigationState;
