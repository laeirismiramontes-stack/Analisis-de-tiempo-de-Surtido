# Análisis de Tiempo de Surtido · Kuroda

Tablero web para analizar los tiempos de surtido del reporte SAP **ZTPOENT**.

## Qué muestra

- **Filtro Día / Semana / Mes** con selector del periodo a revisar.
- **Horas críticas de surtido**: pedidos por hora de pago, tiempo promedio por hora y mapa de calor día × hora.
- **Ranking de surtidores** del periodo (menor tiempo promedio primero) y **mejor surtidor por día, semana o mes**.
- **Promedio de pedidos** diario, semanal y mensual sobre todo el histórico.
- Filtro por plazo de entrega y opción para excluir tiempos atípicos (> 120 min).

## Actualizar la base de datos

1. Clic en **Actualizar base de datos** y selecciona el Excel ZTPOENT.
2. Los registros se unen al histórico usando el **Folio de Entrega** como llave, así que basta subir solo los días nuevos (si un folio ya existe se actualiza, no se duplica).
3. En el encabezado se muestra la fecha y hora de la última carga y hasta qué día hay datos.

## Acceso y base de datos (Supabase)

- Inicio de sesión con **correo y contraseña** (Supabase Auth). Cualquiera puede crear cuenta, pero solo ven información los correos de la tabla `usuarios_autorizados`.
- Roles: **admin** (sube el Excel y administra usuarios desde el botón *Usuarios*) y **lector** (solo consulta).
- Tablas con **RLS** activado: `usuarios_autorizados`, `registros_surtido` (llave: folio de entrega) y `cargas` (bitácora de cada actualización). Los visitantes sin sesión no tienen acceso a ninguna tabla.
- Los datos no se guardan en este repositorio.

## Desarrollo

Crea un archivo `.env` con:

```
VITE_SUPABASE_URL=https://<proyecto>.supabase.co
VITE_SUPABASE_KEY=<publishable key>
```

```bash
npm install
npm run dev
```

`npm run build` genera la versión de producción en `dist/` (Vercel la detecta automáticamente como proyecto Vite).
