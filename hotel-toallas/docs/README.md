# Sistema de Control de Toallas para Hotel

Sistema web para controlar la entrega y devolución de toallas en un hotel.

Funciona en red local usando una computadora como servidor y las demás como clientes.

## Tecnologías

- Node.js
- Express
- SQLite con better-sqlite3
- Socket.IO
- HTML
- CSS
- JavaScript

## Funciones principales

- Login por roles:
  - admin
  - recepcion
  - toallero

- Registro de huéspedes.
- Código de tarjeta escaneado o escrito; se puede reutilizar después del check-out.
- Exportación de la base de datos a Excel (incluye huéspedes con check-out); después se limpia el historial.
- Límite de toallas configurable por huésped.
- Entrega y devolución de toallas.
- Validación para no exceder el límite.
- Check-out bloqueado si el huésped no tiene 0 toallas.
- Historial con hora de Ciudad de México.
- Actualización entre computadoras usando Socket.IO.

## Base de datos

El sistema crea automáticamente el archivo:

```text
toallas.db
```

No necesitas crear la base de datos manualmente.

## Usuarios iniciales

Cuando se ejecuta por primera vez, crea estos usuarios:

| Usuario | Contraseña | Rol |
|---|---|---|
| admin | admin123 | admin |
| recepcion | recepcion123 | recepcion |
| toallero | toallero123 | toallero |

Importante: cambia o desactiva estos usuarios en producción.

## Instalación

1. Instalar Node.js LTS.
2. Abrir terminal en la carpeta del proyecto.
3. Ejecutar:

```bash
npm install
```

4. Iniciar:

```bash
npm start
```

En Windows también puedes usar:

```text
install.bat
start.bat
```

## Acceso local

En la misma computadora:

```text
http://localhost:3000
```

En otras computadoras de la red:

```text
http://IP_DEL_SERVIDOR:3000
```

Ejemplo:

```text
http://192.168.1.50:3000
```

## Código de tarjeta

El código de tarjeta se escanea o escribe al registrar al huésped (numérico, 4 a 20 dígitos).
El sistema ya no genera ni imprime códigos de barras.

Un código y una habitación solo pueden estar en uso por un huésped activo; tras el check-out quedan libres para reutilizarse.

## Respaldo

Respaldar el archivo:

```text
toallas.db
```

Se recomienda hacer copias diarias.


## Publicar en internet
Ver `docs/DESPLIEGUE.md` (Docker + HTTPS automático, variables de entorno y respaldos).
