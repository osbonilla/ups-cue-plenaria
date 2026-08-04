import React, { useEffect } from "react";
import { observer } from "mobx-react-lite";
import state from "../../stores/state";
import assistantStore from "../../stores/assistant";
import { buscarLugar, listarLugares } from "../../utils/assetsQuery";

export const AssistantExecutor: React.FC = observer(() => {
  useEffect(() => {
    const cmd = assistantStore.command;
    if (!cmd) return;
    const view = state.getView("scene");
    if (!view) return;

    const run = async () => {
      if (cmd.tool === "buscar_lugar") {
        const { categoria, nombre } = cmd.args as any;
        const r = await buscarLugar(view, categoria, nombre);
        if (r.found) {
          assistantStore.pushReply(
            `Encontré ${r.count} espacio(s) de ${categoria}${nombre ? ` (${nombre})` : ""} y los resalté en el mapa.`,
          );
        } else {
          assistantStore.pushReply(`No encontré espacios de ${categoria}${nombre ? ` con "${nombre}"` : ""}.`);
        }
      } else if (cmd.tool === "listar_lugares") {
        const { categoria } = cmd.args as any;
        const r = await listarLugares(view, categoria);
        if (r.found) {
          const lista = r.names.length ? ` Algunos: ${r.names.join(", ")}${r.count > r.names.length ? "…" : ""}.` : "";
          assistantStore.pushReply(`Hay ${r.count} espacio(s) de ${categoria}.${lista}`);
        } else {
          assistantStore.pushReply(`No hay espacios registrados de ${categoria}.`);
        }
      }
    };

    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantStore.command?.id]);

  return null;
});