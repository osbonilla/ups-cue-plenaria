"""
Puente a Ollama: recibe una pregunta en lenguaje natural y decide qué
herramienta GIS ejecutar (tool calling). NO ejecuta nada del mapa: solo
devuelve a React el nombre de la herramienta + argumentos. React ejecuta
la herramienta real sobre la escena.
"""
import json
import requests

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL = "qwen2.5"

# Catálogo de herramientas que el asistente puede invocar. Cada una se mapea
# 1:1 con una acción real que React sabe ejecutar sobre la escena.
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "buscar_lugar",
            "description": (
                "Busca lugares/espacios del edificio por su categoría y opcionalmente los resalta "
                "en el mapa. Úsala cuando el usuario pregunta dónde está algo o quiere ver un tipo "
                "de espacio. Categorías válidas: ADMINISTRATIVO, AULAS, BIBLIOTECA, CENTROS DE AYUDA, "
                "DEPORTE, GARITA, LABORATORIO, RECEPCIÓN, SALA DE ACTOS, SANITARIOS, SEGURIDAD, "
                "SERVICIO DE ALIMENTACIÓN, TERRAZA."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "categoria": {
                        "type": "string",
                        "description": "Categoría del espacio a buscar (ej: BIBLIOTECA, AULAS, LABORATORIO).",
                    },
                    "nombre": {
                        "type": "string",
                        "description": "Opcional: número o nombre específico del espacio (ej: '102').",
                    },
                },
                "required": ["categoria"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "listar_lugares",
            "description": (
                "Lista los espacios de una categoría dada y devuelve cuántos hay. Úsala cuando el "
                "usuario pregunta qué o cuántos espacios de un tipo existen (ej: '¿qué aulas hay?', "
                "'¿cuántos laboratorios tiene el edificio?'). Mismas categorías que buscar_lugar."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "categoria": {
                        "type": "string",
                        "description": "Categoría a listar (ej: AULAS, LABORATORIO, ADMINISTRATIVO).",
                    },
                },
                "required": ["categoria"],
            },
        },
    },
]

SYSTEM_PROMPT = (
    "Eres el asistente de un gemelo digital del edificio Bloque A del campus UPS. "
    "Interpretas la petición del usuario y decides qué herramienta ejecutar. "
    "El edificio tiene estas categorías de espacios: ADMINISTRATIVO, AULAS, BIBLIOTECA, "
    "CENTROS DE AYUDA, DEPORTE, GARITA, LABORATORIO, RECEPCIÓN, SALA DE ACTOS, SANITARIOS, "
    "SEGURIDAD, SERVICIO DE ALIMENTACIÓN, TERRAZA. "
    "Cuando el usuario pregunte por un tipo de espacio, usa la categoría más parecida de esa lista "
    "(ej: 'baños' -> SANITARIOS, 'oficinas' -> ADMINISTRATIVO, 'canchas' o 'gimnasio' -> DEPORTE, "
    "'laboratorios' -> LABORATORIO, 'salón de eventos' -> SALA DE ACTOS). "
    "Si pregunta DÓNDE está algo o quiere verlo, usa buscar_lugar. "
    "Si pregunta QUÉ o CUÁNTOS hay, usa listar_lugares. "
    "Para acciones del mapa usa las otras herramientas. Responde siempre en español."
)

def ask_agent(user_message: str) -> dict:
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "tools": TOOLS,
        "stream": False,
    }

    resp = requests.post(OLLAMA_URL, json=payload, timeout=120)
    resp.raise_for_status()
    data = resp.json()

    message = data.get("message", {})
    tool_calls = message.get("tool_calls", [])

    if tool_calls:
        # Devuelve la primera herramienta que el modelo decidió llamar.
        call = tool_calls[0]
        fn = call.get("function", {})
        name = fn.get("name")
        args = fn.get("arguments", {})
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                args = {}
        return {"type": "tool", "tool": name, "args": args, "text": message.get("content", "")}

    # Sin herramienta: respuesta conversacional.
    return {"type": "text", "text": message.get("content", "").strip()}