# OpenCode Claude Bridge

Seguí una conversación de Claude Code en OpenCode sin perder el contexto.

## El problema

Venís trabajando en un tema con Claude Code. Querés pasarte a OpenCode por el motivo que sea (otro modelo, te quedaste sin tokens, etc). Cuando abrís OpenCode, empieza una conversación en blanco: no sabe qué estabas haciendo, qué decidieron juntos, qué archivos tocaste, dónde quedó trabado el problema. Tenés que explicar todo desde cero.

Este plugin resuelve eso: leé el transcript local que Claude guarda en tu máquina y lo inyectá como si fuera el historial propio de la sesión de OpenCode. El modelo arranca sabiendo con quién está hablando y dónde quedaron.

## Cómo se siente usarlo

Abrís OpenCode en un proyecto donde ya estuviste laburando con Claude. Ejecutás `/resume-claude-last` o `/resume-claude-session <sessionId>`. Escribís tu próximo mensaje como si nada. El modelo te responde conectado al tema anterior, en el mismo idioma, con el mismo nivel de detalle, sin pedirte que le expliques qué estabas haciendo.

## Instalación

```bash
npm install
npm run build
```

Apuntá tu `opencode.json` al build:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["./dist/index.js"]
}
```

O desde otro proyecto:

```json
{
  "plugin": ["../opencode-plugin/dist/index.js"]
}
```

## Uso

Dos comandos disponibles dentro de OpenCode:

### `/resume-claude-last`

Retoma la última sesión de Claude del proyecto actual. Útil cuando acabás de cerrar Claude y querés seguir.

### `/resume-claude-session <sessionId>`

Retoma una sesión específica por ID. Útil cuando querés volver a algo de hace días.

Después de ejecutar el comando, OpenCode te muestra cuántos mensajes cargó y el último que te dijo Claude, así sabés desde dónde retomás.

## Qué se importa

Del transcript de Claude el plugin saca:

- el objetivo original de la sesión
- los últimos intercambios (mensajes + herramientas que usó Claude y qué devolvieron)
- los archivos que se tocaron, los comandos que se corrieron
- el idioma en el que venían hablando
- metadatos de contexto (rama git, directorio, etc.)

Todo eso se formatea como una conversación en curso y queda asociado a la sesión de OpenCode. Si cerrás y volvés a abrir, el contexto sigue ahí (persiste en disco dentro de `.opencode/`).

## Lo que no hace

- No replica el estado interno del modelo Claude. Lo que replica es la conversación visible.
- No importa automáticamente. Tenés que ejecutar el comando.
- No copia MCPs ni tools de Claude que no estén en OpenCode. Si Claude estaba usando un servidor MCP que no tenés acá, lo vas a ver mencionado pero no vas a poder usarlo.

## Costo

Cada turno en la sesión de OpenCode incluye el contexto importado (~5-7K tokens). Con prompt caching habilitado, el costo real después del primer turno es bajo. Sin caching, el consumo es lineal al tamaño del historial importado por cada mensaje.

## Pendientes conocidos

- Resumen denso generado por LLM en vez de truncado (ahora corta después de 40 mensajes)
- Sincronización en vivo si Claude sigue escribiendo en paralelo
- Auto-import al abrir una sesión nueva en un proyecto con historia reciente de Claude

