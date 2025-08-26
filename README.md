# Midari AI

Asistente de IA en el navegador con conexión a OpenRouter. Chat con respuestas en streaming, historial de conversaciones y Markdown seguro. Sin backend.

## Características
- **Streaming**: respuestas palabra por palabra desde OpenRouter.
- **Selector de modelo**: elige el modelo desde el catálogo público.
- **Solo modelos gratis**: toggle para mostrar únicamente modelos con costo 0 (si no hay, se indica en pantalla).
- **Historial de chats**: persistencia en `localStorage`.
- **Markdown seguro**: render con `marked.js` y sanitización con `DOMPurify`.
- **Settings**: configura nombre de usuario y foto de perfil. Se guarda localmente.

## Requisitos
- Navegador moderno (recomendado Chrome/Edge actual).
- Conexión a internet (usa la API de OpenRouter).
- Servir con un **servidor local** (no abrir `index.html` directamente) por uso de módulos y Web Worker.

## Cómo ejecutar
Desde la carpeta del proyecto, usa una de estas opciones y abre el puerto indicado:

- VS Code (Live Server): "Open with Live Server" → `http://localhost:5500`
- Python:
  ```bash
  python -m http.server 5500
  ```
  Luego ve a: http://localhost:5500
- Node:
  ```bash
  npx serve -p 5500
  ```

## Configuración rápida
1. Abre la aplicación en el navegador.
2. En la barra lateral (Settings), pega tu **API key de OpenRouter** y pulsa Guardar.
3. Opcional: activa “Solo modelos gratis”. Si no hay gratis, desactívalo temporalmente o usa una cuenta con créditos.
4. Elige el modelo en el selector y comienza a chatear.

## Uso
- Escribe tu mensaje y presiona Enter.
- “Nuevo Chat” crea conversaciones separadas (persisten en `localStorage`).
- El botón Guardar en Settings guarda tu clave de API para la sesión actual y mantiene modelo, historial y perfil localmente.


## Notas y errores comunes
- 401: API key inválida o sin permisos.
- 402: créditos insuficientes en OpenRouter (no podrás usar modelos de pago).
- Si el catálogo de modelos no carga por CORS, se usa una lista de respaldo.
- La clave de API se guarda solo en tu navegador durante la sesión.

