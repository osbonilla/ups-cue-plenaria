import React from "react";

import { DarkModeSwitch } from "../DarkModeSwitch";
import { Identity } from "../Identity";
import { InlineNavToggles } from "../InlineNavToggles";
import { ViewModeSwitch } from "../ViewModeSwitch";

import "@esri/calcite-components/dist/components/calcite-navigation";
import "@esri/calcite-components/dist/components/calcite-navigation-logo";
import "@esri/calcite-components/dist/components/calcite-menu";
import "@esri/calcite-components/dist/components/calcite-action";
import "@esri/calcite-components/dist/components/calcite-navigation-user";

import {applicationTitle, applicationDescription} from "../../config";

export const Navigation: React.FC = () => (
  <calcite-navigation slot="header">
    <calcite-navigation-logo
      slot="logo"
      heading={applicationTitle}
      description={applicationDescription}
    ></calcite-navigation-logo>
    <InlineNavToggles></InlineNavToggles>
    <ViewModeSwitch slot="content-end"></ViewModeSwitch>
    <DarkModeSwitch slot="content-end"></DarkModeSwitch>
    <Identity></Identity>
  </calcite-navigation>
);