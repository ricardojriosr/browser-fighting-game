# Neon Clash Arena

Juego de combate 2D original hecho con HTML5 Canvas, CSS y JavaScript puro.

## No necesita Python, Node ni un servicio adicional

No necesitas ejecutar `python3 -m http.server 8080`.

Solo copia la carpeta del juego dentro de la carpeta pública de tu servidor web existente.

## XAMPP en Windows

Copia `neon-clash-arena` dentro de:

```text
C:\xampp\htdocs\
```

Abre:

```text
http://localhost/neon-clash-arena/
```

## WAMP en Windows

Copia la carpeta dentro de:

```text
C:\wamp64\www\
```

Abre:

```text
http://localhost/neon-clash-arena/
```

## Apache en Linux

Copia la carpeta dentro de:

```text
/var/www/html/
```

Ejemplo:

```bash
sudo cp -R neon-clash-arena /var/www/html/
```

Abre:

```text
http://localhost/neon-clash-arena/
```

## Nginx

Copia la carpeta dentro del `root` configurado para tu sitio, por ejemplo:

```text
/var/www/html/neon-clash-arena/
```

No necesita reglas especiales de Nginx.

## cPanel o hosting

Sube todo a:

```text
public_html/neon-clash-arena/
```

Abre:

```text
https://tudominio.com/neon-clash-arena/
```

También puedes extraer el paquete `public-html` directamente en la raíz de `public_html` para publicar el juego en el dominio principal.

## Archivos principales

- `index.html`: entrada universal.
- `index.php`: respaldo opcional para servidores PHP.
- `.htaccess`: configuración opcional de Apache.
- `diagnostic.html`: prueba de archivos y compatibilidad.
- `js/game.js`: motor del juego.
- `styles.css`: interfaz y controles móviles.

PHP y base de datos no son necesarios.

## Diagnóstico

Abre:

```text
http://localhost/neon-clash-arena/diagnostic.html
```

o:

```text
https://tudominio.com/neon-clash-arena/diagnostic.html
```

## Nota sobre abrir index.html con doble clic

El combate funciona bajo `file://`, pero la instalación PWA y el modo offline completo requieren HTTP o HTTPS. Tu Apache, Nginx, IIS, XAMPP, WAMP o hosting ya proporciona eso sin ejecutar un servicio adicional.
