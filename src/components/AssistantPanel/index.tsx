import React, { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { predictionConfig } from "../../config";
import assistantStore from "../../stores/assistant";
import navigationState from "../../stores/navigation";
import styles from "./AssistantPanel.module.css";

type Msg = { role: "user" | "assistant"; text: string };

const TOOL_LABELS: Record<string, string> = {
  mostrar_hotspots: "Mostrando zonas de riesgo (hotspots)…",
  enfocar_campus: "Enfocando el campus…",
  consultar_zona: "Consultando la zona de análisis…",
  predecir_punto: "Activando el modo predicción…",
  ir_a_piso: "Cambiando de piso…",
  buscar_lugar: "Buscando en el edificio…",
  listar_lugares: "Consultando el edificio…",
};

export const AssistantPanel: React.FC = observer(() => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", text: "Hola, soy el asistente del gemelo digital. Pídeme: “muéstrame las zonas de riesgo”, “enfoca el edificio”, “¿dónde está la biblioteca?”, “¿cuántas aulas hay?”, “ve al piso 3”." },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Respuestas que devuelve el ejecutor (búsquedas/listados al BIM).
  useEffect(() => {
    const r = assistantStore.reply;
    if (!r) return;
    setMessages((m) => [...m, { role: "assistant", text: r.text }]);
    setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" }), 50);
  }, [assistantStore.reply?.id]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${predictionConfig.baseUrl}/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.type === "tool" && data.tool) {
        // Asegura que el panel dueño de la herramienta esté montado antes de ejecutarla.
        const needsSecurity =
          data.tool === "mostrar_hotspots" ||
          data.tool === "predecir_punto" ||
          data.tool === "consultar_zona";

        const justOpenedSecurity = needsSecurity && !navigationState.toggles.security;
        if (justOpenedSecurity) {
          navigationState.toggle("security");
        }
        if (data.tool === "ir_a_piso" && !navigationState.toggles.floors) {
          navigationState.toggle("floors");
        }

        // Espera a que el panel se monte (si acabamos de abrirlo) antes de emitir.
        setTimeout(() => {
          assistantStore.emit(data.tool, data.args ?? {});
        }, justOpenedSecurity ? 700 : 150);

        const label = TOOL_LABELS[data.tool] ?? `Ejecutando ${data.tool}…`;
        setMessages((m) => [...m, { role: "assistant", text: label }]);
      } else if (data.type === "text") {
        setMessages((m) => [...m, { role: "assistant", text: data.text || "…" }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", text: data.text || "No pude procesar eso." }]);
      }
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `No pude conectar con el asistente. Revisa que el backend (${predictionConfig.baseUrl}) y Ollama estén corriendo.` },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" }), 50);
    }
  };

  if (!open) {
    return (
      <button className={styles.fab} onClick={() => setOpen(true)} title="Asistente de IA" aria-label="Abrir asistente">
        <span className={styles.fabIcon}>💬</span>
      </button>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <span className={styles.headerDot}></span>
          <span>Asistente · Gemelo Digital</span>
        </div>
        <button className={styles.close} onClick={() => setOpen(false)} aria-label="Cerrar">✕</button>
      </div>
      <div className={styles.messages} ref={scrollRef}>
        {messages.map((m, i) => (
          <div key={i} className={`${styles.msg} ${m.role === "user" ? styles.user : styles.assistant}`}>
            {m.text}
          </div>
        ))}
        {loading ? <div className={`${styles.msg} ${styles.assistant}`}>Pensando…</div> : null}
      </div>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Escribe una orden…"
          disabled={loading}
        />
        <button className={styles.sendBtn} onClick={send} disabled={loading || !input.trim()}>➤</button>
      </div>
    </div>
  );
});