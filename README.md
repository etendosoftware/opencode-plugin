# OpenCode Claude Bridge

Seguí una conversación de Claude Code en OpenCode sin perder el contexto.

## El problema

Venís trabajando en un tema con Claude Code. Querés pasarte a OpenCode por el motivo que sea (otro modelo, te quedaste sin tokens, etc). Cuando abrís OpenCode, empieza una conversación en blanco: no sabe qué estabas haciendo, qué decidieron juntos, qué archivos tocaste, dónde quedó trabado el problema. Tenés que explicar todo desde cero.

Este plugin resuelve eso: leé el transcript local que Claude guarda en tu máquina y lo inyectá como si fuera el historial propio de la sesión de OpenCode. El modelo arranca sabiendo con quién está hablando y dónde quedaron.

## Cómo se siente usarlo

Abrís OpenCode en un proyecto donde ya estuviste laburando con Claude. Ejecutás `/resume-claude-last` o `/resume-claude-session <sessionId>`. Escribís tu próximo mensaje como si nada. El modelo te responde conectado al tema anterior, en el mismo idioma, con el mismo nivel de detalle, sin pedirte que le expliques qué estabas haciendo.

## Instalación

Agregá el plugin a tu config global de OpenCode (`~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-claude-bridge-plugin"]
}
```

OpenCode descarga el plugin desde npm automáticamente al arrancar. No hace falta ningún `npm install`.

Para fijar una versión específica (recomendado): `"opencode-claude-bridge-plugin@1.0.1"`.

### Desarrollo local

Si querés modificar el plugin:

```bash
git clone git@github.com:etendosoftware/opencode-plugin.git
cd opencode-plugin
npm install
npm run build
```

Luego apuntá el config al `dist/` local:

```json
{
  "plugin": ["/ruta/absoluta/al/opencode-plugin/dist/index.js"]
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

El plugin arma un bloque de contexto con tres partes:

**Metadatos de la sesión** — proyecto, rama git, idioma detectado, cantidad total de mensajes.

**Resumen de lo que pasó antes** — si la sesión tiene más de 40 mensajes, el plugin usa el modelo que tenés activo en OpenCode para generar un resumen estructurado (objetivo, decisiones clave, archivos tocados, estado al final de esa parte, hilos abiertos). Se cachea en disco: si importás la misma sesión de nuevo, no se regenera.

**Los últimos 40 mensajes verbatim** — incluyendo los comandos que corrió Claude y qué devolvieron, para que el modelo vea exactamente dónde quedaron.

Todo persiste en disco dentro de `.opencode/`. Si cerrás OpenCode y lo reabrís, el contexto sigue disponible sin tener que importar de nuevo.

## Lo que no hace

- No replica el estado interno del modelo Claude. Lo que replica es la conversación visible.
- No importa automáticamente. Tenés que ejecutar el comando.
- No copia MCPs ni tools de Claude que no estén en OpenCode. Si Claude estaba usando un servidor MCP que no tenés acá, lo vas a ver mencionado pero no vas a poder usarlo.

## Telemetría con Fyso Teams

Si tu equipo usa [Fyso Teams](https://teams.fyso.dev), el plugin puede reportar el uso de OpenCode al mismo dashboard donde ya ves el gasto de Claude Code.

Para activarlo, creá `.opencode/telemetry.json` en el proyecto:

```json
{
  "token": "<tu-token-de-fyso>",
  "tenant_id": "<tu-tenant-id>",
  "api_url": "https://api.fyso.dev",
  "user": "tu@email.com",
  "team_name": "nombre-del-equipo"
}
```

Con eso el plugin empieza a enviar datos de tokens consumidos, costo por turno y uso de herramientas a Fyso Teams. El tracking es opcional y no afecta el funcionamiento del plugin.

## Costo

El contexto importado pesa ~5–7K tokens. Con prompt caching habilitado (activo por defecto en OpenCode), el costo real después del primer turno es mínimo — el bloque se cachea y los turnos siguientes solo pagan el cache read. El resumen se genera una sola vez por sesión y se reutiliza.

