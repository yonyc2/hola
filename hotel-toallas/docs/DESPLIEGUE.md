# Publicar el sistema en internet

El sistema ya es una aplicación web (se usa desde el navegador). Para publicarlo hace falta un servidor
con internet, HTTPS y un disco que no se borre. Esta guía usa Docker + Caddy (HTTPS automático).

## Qué necesitas
1. Un servidor Linux (VPS) con Docker y Docker Compose instalados. Por ejemplo una máquina gratuita
   de Google Cloud (e2-micro) o un VPS de pocos dólares al mes.
2. Un dominio o subdominio que apunte a la IP del servidor (por ejemplo uno gratuito de duckdns.org).
3. Los puertos 80 y 443 abiertos en el firewall del servidor.

## Pasos
1. Copia esta carpeta al servidor (sin `node_modules`).
2. Copia `.env.example` como `.env` y llena `DOMINIO`, `SESSION_SECRET` e `INITIAL_ADMIN_PASSWORD`.
   Para generar la clave: `openssl rand -hex 32`
3. Crea la carpeta de datos con permisos para el contenedor:
   ```
   mkdir -p data && sudo chown 1000:1000 data
   ```
4. Levanta el sistema:
   ```
   docker compose up -d --build
   ```
5. Entra a `https://TU-DOMINIO` con el usuario `admin` y la contraseña que definiste.
   Si dejaste `INITIAL_ADMIN_PASSWORD` vacía, búscala con `docker compose logs app`.
6. Desde el panel de administración crea los usuarios de recepción y toallero.

En producción solo se crea el usuario `admin`; **no** se crean `recepcion` ni `toallero` con contraseñas conocidas.

## Llevar tus datos actuales
Con el servidor detenido (`docker compose down`), copia tu `toallas.db` a la carpeta `data/` del servidor,
ponle los permisos con `sudo chown 1000:1000 data/toallas.db` y vuelve a levantar. Entra con los usuarios
que ya tenías.

## Variables de entorno
| Variable | Para qué sirve |
|---|---|
| `NODE_ENV=production` | Cookies seguras, HSTS y usuarios iniciales seguros |
| `DATA_DIR` | Carpeta de la base de datos y respaldos (en Docker: `/data`) |
| `SESSION_SECRET` | Clave de las sesiones (obligatoria) |
| `INITIAL_ADMIN_PASSWORD` | Contraseña inicial de `admin` (solo la primera vez) |
| `TRUST_PROXY` | Proxys delante del servidor (por defecto 1 en producción) |
| `PORT` | Puerto interno (por defecto 3000) |

## Respaldos
- El sistema guarda una copia diaria de la base en `data/backups/` y conserva las últimas 14.
- Esas copias están en el **mismo servidor**: si el servidor se pierde, también se pierden. Descarga el
  Excel con **Exportar base de datos** y copia `data/toallas.db` a otro lugar con regularidad.

## Notas
- Las sesiones se guardan en memoria: si reinicias el servidor, los usuarios tendrán que volver a iniciar sesión.
- Para actualizar el programa: reemplaza los archivos (menos `data/`) y ejecuta `docker compose up -d --build`.
- Ver registros: `docker compose logs -f app`.
- El sistema guarda nombres de huéspedes y habitaciones: usa contraseñas fuertes y limita quién tiene usuario.
