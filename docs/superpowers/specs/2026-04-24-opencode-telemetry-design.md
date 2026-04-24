# Diseño: Telemetría Fyso para OpenCode Plugin

**Fecha:** 2026-04-24  
**Estado:** Aprobado

## Objetivo

Agregar telemetría al opencode-plugin para que envíe datos de uso al mismo endpoint de Fyso que usa fyso-team-sync (`/api/entities/tracking/records`). Esto permite ver actividad de OpenCode junto con la actividad de Claude Code en Fyso.

## Contexto

- **fyso-team-sync** envía telemetría vía shell scripts disparados por hooks de Claude Code. Lee credenciales de `~/.fyso/config.json`.
- **opencode-plugin** es TypeScript, usa la API de plugins de OpenCode. Actualmente no tiene telemetría.
- El SDK de OpenCode expone un hook `event` con `EventMessageUpdated` que se dispara al completar cada respuesta LLM, incluyendo token counts y costo calculado.

## Arquitectura

Nuevo módulo `src/telemetry/` con cuatro archivos. `index.ts` registra el hook `event` y delega todo a este módulo.

```
src/telemetry/
├── config.ts     # Lee ~/.fyso/config.json y .fyso/team.json
├── client.ts     # HTTP POST fire-and-forget al endpoint de Fyso
├── tracker.ts    # Acumula totales de sesión en memoria
└── events.ts     # Construye payloads y dispara eventos
```

### `config.ts`

Lee `~/.fyso/config.json` (campos: `token`, `tenant_id`, `api_url`, `user_email`) y `.fyso/team.json` (campo: `team_name`) una sola vez al init del plugin. Si el archivo no existe o el token está vacío, retorna `null`. Si `OPENCODE_FYSO_TELEMETRY=0`, retorna `null`. Ningún error de lectura se propaga.

### `client.ts`

Función `sendEvent(payload, config)`:
- `fetch` POST a `{api_url}/api/entities/tracking/records`
- Headers: `Authorization: Bearer {token}`, `X-Tenant-ID: {tenant_id}`, `Content-Type: application/json`
- Timeout: 5 segundos via `AbortController`
- Fire-and-forget: swallow cualquier error (network, timeout, non-2xx). La telemetría nunca rompe el plugin.

### `tracker.ts`

Clase `SessionTracker` con `Map<sessionId, SessionTotals>` en memoria:

```typescript
type SessionTotals = {
  tokens: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
};
```

Método `add(sessionId, delta)` acumula los valores del turno actual. Método `get(sessionId)` retorna los totales acumulados. No necesita cleanup: el Map vive mientras el proceso de OpenCode esté activo.

### `events.ts`

Tres funciones públicas:

**`onMessageCompleted(event, ctx)`** — disparada por `EventMessageUpdated`. Extrae tokens, costo y modelo del `AssistantMessage`. Llama a `tracker.add()`, luego construye y envía payload con evento `opencode_turn`.

**`onToolUsed(toolName, sessionId, detail, ctx)`** — llamada desde `resume_claude_last` y `resume_claude_session` al terminar exitosamente. Envía evento `opencode_tool_use` con el nombre del tool y un `detail` con la sesión de Claude importada y cantidad de mensajes.

**`onSessionStart(sessionId, ctx)`** — disparada por `EventSessionStatus` cuando la sesión pasa a estado activo. Envía evento `opencode_session_start`.

## Eventos

| Evento | Trigger | Hook |
|--------|---------|------|
| `opencode_session_start` | `EventSessionStatus` — sesión activa | `event` hook |
| `opencode_turn` | `EventMessageUpdated` — LLM responde | `event` hook |
| `opencode_tool_use` | `resume_claude_last` / `resume_claude_session` ejecutados | dentro del tool |

## Payload Schema

Todos los eventos comparten este schema (campos no aplicables se envían como `null`):

```json
{
  "event": "opencode_turn",
  "source": "opencode",
  "opencode": true,

  "session_id": "abc123",
  "model": "claude-sonnet-4-6",
  "model_family": "sonnet",

  "tokens": 1500,
  "input_tokens": 800,
  "output_tokens": 700,
  "cache_creation_tokens": 0,
  "cache_read_tokens": 0,

  "session_tokens": 4200,
  "session_input_tokens": 2100,
  "session_output_tokens": 2100,
  "session_cache_creation_tokens": 0,
  "session_cache_read_tokens": 0,

  "cost_usd": 0.0042,

  "team_name": "my-team",
  "user": "facumoyano44@gmail.com",
  "cwd": "/home/usuario/projects/opencode-plugin",
  "timestamp": "2026-04-24T14:30:00Z"
}
```

### Origen de cada campo

| Campo | Origen |
|-------|--------|
| `event` | constante por tipo de evento |
| `source` | `"opencode"` (constante) |
| `opencode` | `true` (constante) |
| `session_id` | `EventMessageUpdated.sessionID` o `EventSessionStatus.sessionID` |
| `model` | `AssistantMessage.model.id` o `event.model.id` |
| `model_family` | derivado de `model.id`: contiene `"opus"` → `"opus"`, `"sonnet"` → `"sonnet"`, `"haiku"` → `"haiku"`, otro → `null` |
| `tokens` | suma de `input + output + cache_creation + cache_read` del turno |
| `input_tokens` | `AssistantMessage.tokens.input` |
| `output_tokens` | `AssistantMessage.tokens.output` |
| `cache_creation_tokens` | `AssistantMessage.tokens.cache.write` |
| `cache_read_tokens` | `AssistantMessage.tokens.cache.read` |
| `session_tokens` | acumulado en `SessionTracker` |
| `session_input_tokens` | acumulado en `SessionTracker` |
| `session_output_tokens` | acumulado en `SessionTracker` |
| `session_cache_creation_tokens` | acumulado en `SessionTracker` |
| `session_cache_read_tokens` | acumulado en `SessionTracker` |
| `cost_usd` | `AssistantMessage.cost` (calculado por el SDK para todos los proveedores) |
| `team_name` | `.fyso/team.json` → `team_name` (leído al init) |
| `user` | `~/.fyso/config.json` → `user_email` |
| `cwd` | `pluginInput.directory` |
| `timestamp` | `new Date().toISOString()` |

**`cost_usd` para modelos sin pricing:** el SDK retorna `0` o `undefined`; en ese caso se envía `0`.

## Integración en `index.ts`

Al init del plugin:
1. Llamar `loadTelemetryConfig(pluginInput)` — retorna `TelemetryContext | null`
2. Si no es `null`, registrar hook `event` que filtra `EventMessageUpdated` → `onMessageCompleted` y `EventSessionStatus` → `onSessionStart`
3. Pasar `telemetryCtx` a los tools `resume_claude_last` y `resume_claude_session` para que llamen a `onToolUsed` al finalizar

No se modifica ningún otro archivo fuera de `index.ts` y el nuevo módulo `src/telemetry/`.

## Error handling

- Config no encontrada o token vacío → telemetría deshabilitada silenciosamente
- `OPENCODE_FYSO_TELEMETRY=0` → telemetría deshabilitada
- Errores de red / timeout / non-2xx → swallow, sin log, sin throw
- `AssistantMessage.cost` undefined → se envía `0`
- `AssistantMessage.tokens` undefined → se envían `0` en todos los campos de tokens

## Lo que no hace este diseño

- No heartbeat periódico (a diferencia de fyso-team-sync): OpenCode no expone un mecanismo de timer dentro del plugin API.
- No detección de usage limit hits: eso es específico de Claude Code.
- No tracking de subagentes: OpenCode no tiene el mismo concepto de subagent hooks.
- No escribe a disk (no state file): los totales de sesión viven solo en memoria.
