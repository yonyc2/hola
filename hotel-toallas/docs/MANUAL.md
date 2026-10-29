# Manual de uso

## 1. Instalación en la computadora servidor

La computadora servidor debe estar encendida durante la operación del hotel.

### Paso 1: Instalar Node.js

Descargar Node.js LTS desde:

```text
https://nodejs.org
```

Instalar con opciones normales.

### Paso 2: Colocar el proyecto

Ejemplo:

```text
C:\hotel-toallas
```

### Paso 3: Instalar dependencias

Abrir terminal en la carpeta y ejecutar:

```bash
npm install
```

En Windows también puedes ejecutar:

```text
install.bat
```

### Paso 4: Iniciar el sistema

```bash
npm start
```

O ejecutar:

```text
start.bat
```

El sistema mostrará algo como:

```text
Servidor corriendo en http://0.0.0.0:3000
```

---

## 2. Configurar red local con switch

Todas las computadoras deben estar conectadas al mismo switch.

La PC servidor debe tener una IP fija o reservada.

Ejemplo:

```text
IP del servidor: 192.168.1.50
Puerto: 3000
```

Desde otras computadoras abrir:

```text
http://192.168.1.50:3000
```

Si no abre, revisar firewall de Windows y permitir el puerto 3000 TCP.

Comando para abrir puerto como administrador:

```bash
netsh advfirewall firewall add rule name="Hotel Toallas" dir=in action=allow protocol=TCP localport=3000
```

---

## 3. Usuarios por defecto

| Usuario | Contraseña | Rol |
|---|---|---|
| admin | admin123 | admin |
| recepcion | recepcion123 | recepcion |
| toallero | toallero123 | toallero |

Después de iniciar sesión, cada usuario es redirigido a su área.

---

## 4. Manual para recepción

### Registrar huésped

1. Entrar con usuario de recepción.
2. Llenar:
   - Nombre del huésped.
   - Número de habitación.
   - Código de tarjeta (escanearlo o escribirlo; es obligatorio).
   - Cantidad de tarjetas.
   - Límite de toallas.
   - Toallas iniciales.
   - Comentario.
3. Presionar `Guardar huésped`.

Un código de tarjeta y una habitación solo pueden estar en uso por **un huésped activo** a la vez.
Después del check-out, el mismo código y la misma habitación se pueden volver a registrar.

### Cambiar límite de toallas

1. Buscar huésped.
2. Presionar `Ver`.
3. Cambiar `Nuevo límite de toallas`.
4. Presionar `Guardar cambios`.

El sistema no permite poner un límite menor a las toallas que ya tiene el huésped.

### Check-out

Para registrar salida:

- El huésped debe tener `0` toallas actuales.

Si tiene toallas pendientes, el botón de check-out estará bloqueado.

---

## 5. Manual para toallero

1. Entrar con usuario de toallero.
2. Escanear la tarjeta del huésped.
3. El sistema muestra:
   - Nombre.
   - Habitación.
   - Límite de toallas.
   - Toallas actuales.
   - Toallas disponibles.
4. Escribir cantidad.
5. Presionar:
   - `Entregar toallas` para sumar.
   - `Devolver toallas` para restar.

El sistema no permite entregar más toallas que el límite.

Tampoco permite devolver más toallas de las que tiene el huésped.

---

## 6. Manual para administrador

El administrador puede:

- Crear usuarios.
- Activar o desactivar usuarios.
- Ver historial completo.

### Crear usuario

1. Entrar como admin.
2. Llenar formulario.
3. Presionar `Crear usuario`.

### Exportar base de datos

El botón `Exportar base de datos` (arriba a la derecha):

1. Pide confirmación.
2. Descarga un archivo Excel (`.xlsx`) con **toda** la base: usuarios, huéspedes (activos y con check-out, con todos sus datos), movimientos de toallas e historial (no incluye contraseñas).
3. Guarda una copia de seguridad en la carpeta `backups/` del servidor.
4. **Borra el historial**. Los usuarios, los huéspedes (incluidos los que ya hicieron check-out) y sus movimientos de toallas se conservan.

Después de limpiar queda un único registro de historial con la exportación.

### Ver historial

El historial muestra:

- Fecha y hora exacta en CDMX.
- Usuario que realizó la acción.
- Acción.
- Huésped.
- Habitación.
- Valores anteriores.
- Valores nuevos.

---

## 7. Horario de Ciudad de México

El sistema guarda dos fechas:

- UTC.
- Hora CDMX.

La hora mostrada usa:

```text
America/Mexico_City
```

Importante: la computadora servidor debe tener la hora correcta.

Se recomienda activar sincronización automática de hora en Windows.

---

## 8. Solución de problemas

### Otras computadoras no abren la página

Verificar:

1. Que el servidor esté encendido.
2. Que el servidor esté conectado al mismo switch.
3. Que la IP sea correcta.
4. Que el firewall permita puerto 3000.
5. Que el servidor muestre:

```text
Servidor corriendo en http://0.0.0.0:3000
```

### El lector de código no escanea

La mayoría de lectores USB funcionan como teclado.

Recomendaciones:

- Hacer clic en el campo de escaneo.
- Escanear.
- El lector debe presionar Enter automáticamente.
- Si no presiona Enter, configurar el lector para agregar sufijo Enter.

### Error al instalar better-sqlite3

Este paquete es nativo.

En la mayoría de versiones de Node LTS instala automáticamente.

Si falla en Windows, instalar Visual Studio Build Tools con carga de trabajo de desarrollo de escritorio con C++.

---

## 9. Respaldo

El archivo importante es:

```text
toallas.db
```

Recomendación:

- Copiar diario a otra carpeta.
- Copiar semanalmente a USB o nube.
- No borrar los archivos `-wal` y `-shm` mientras el servidor está corriendo.

---

## 10. Seguridad

- Cambia el secreto de sesión en `server.js`.
- Crea usuarios nuevos.
- Desactiva los usuarios de prueba.
- No expongas el puerto 3000 a internet si no es necesario.
- Usa solo dentro de la red local del hotel.
