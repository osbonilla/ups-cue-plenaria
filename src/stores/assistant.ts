import { makeAutoObservable } from "mobx";

export type AssistantCommand =
  | { tool: "mostrar_hotspots"; args: { visible: boolean } }
  | { tool: "enfocar_campus"; args: { activo: boolean } }
  | { tool: "consultar_zona"; args: Record<string, never> }
  | { tool: "predecir_punto"; args: { activo: boolean } }
  | { tool: "ir_a_piso"; args: { nivel: number } }
  | { tool: "buscar_lugar"; args: { categoria: string; nombre?: string } }
  | { tool: "listar_lugares"; args: { categoria: string } };

class AssistantStore {
  command: (AssistantCommand & { id: number }) | null = null;
  // Respuesta que el ejecutor devuelve al chat (para búsquedas/listados).
  reply: { id: number; text: string } | null = null;
  private counter = 0;
  private replyCounter = 0;

  constructor() {
    makeAutoObservable(this);
  }

  emit(tool: string, args: any) {
    this.counter += 1;
    this.command = { tool, args, id: this.counter } as any;
  }

  pushReply(text: string) {
    this.replyCounter += 1;
    this.reply = { id: this.replyCounter, text };
  }
}

const assistantStore = new AssistantStore();
export default assistantStore;