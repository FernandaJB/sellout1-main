package com.manamer.backend.business.sellout.controller;

import com.manamer.backend.business.sellout.models.ExcelUtils;
import com.manamer.backend.business.sellout.models.Venta;
import com.manamer.backend.business.sellout.service.TemplateGeneralService;
import com.manamer.backend.business.sellout.service.VentaService;
import jakarta.servlet.http.HttpServletRequest;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@CrossOrigin(origins = "*", allowedHeaders = "*", methods = {RequestMethod.GET, RequestMethod.POST, RequestMethod.PUT, RequestMethod.DELETE})
@RequestMapping("/api-sellout/template-general")
public class TemplateGeneralController {

    private static final Logger logger = LoggerFactory.getLogger(TemplateGeneralController.class);

    private static final long MAX_UPLOAD_BYTES = 256L * 1024 * 1024; // 256 MB
    private static final Set<String> CONTENT_TYPES_XLS = Set.of(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel",
            "application/octet-stream" // algunos navegadores envían esto
    );

    private final VentaService ventaService;
    private final TemplateGeneralService templateGeneralService;

    public TemplateGeneralController(VentaService ventaService,
                                     TemplateGeneralService templateGeneralService) {
        this.ventaService = ventaService;
        this.templateGeneralService = templateGeneralService;
    }

    // ===================== Ventas (CRUD básico) =====================

    @GetMapping("/venta")
    public ResponseEntity<?> obtenerVentasRapidas(@RequestParam(required = false) String codCliente,
                                                  @RequestParam(required = false) Integer anio,
                                                  @RequestParam(required = false) Integer mes,
                                                  @RequestParam(required = false) String marca,
                                                  @RequestParam(required = false) Integer limit,
                                                  @RequestParam(required = false) Integer offset,
                                                  HttpServletRequest req) {
        String cid = corrId();
        try {
            List<Map<String, Object>> ventas = ventaService.obtenerVentasResumen(codCliente, anio, mes, marca, limit, offset);
            return ResponseEntity.ok()
                    .header("X-Correlation-Id", cid)
                    .body(ventas);
        } catch (Exception e) {
            logger.error("[{}] Error al obtener ventas rápidas: {}", cid, e.getMessage(), e);
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "No se pudieron cargar las ventas.",
                    e.getMessage(), req.getRequestURI(), cid);
        }
    }

    @GetMapping("/venta/{id}")
    public ResponseEntity<?> obtenerVentaPorId(@PathVariable Long id, HttpServletRequest req) {
        String cid = corrId();
        try {
            return ventaService.obtenerVentaPorId(id)
                    .<ResponseEntity<?>>map(v -> ResponseEntity.ok().header("X-Correlation-Id", cid).body(v))
                    .orElseGet(() -> {
                        logger.warn("[{}] Venta no encontrada: id={}", cid, id);
                        return error(HttpStatus.NOT_FOUND, "Venta no encontrada.",
                                "No existe una venta con id=" + id, req.getRequestURI(), cid);
                    });
        } catch (Exception e) {
            logger.error("[{}] Error al obtener venta id={}: {}", cid, id, e.getMessage(), e);
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "No se pudo obtener la venta solicitada.",
                    e.getMessage(), req.getRequestURI(), cid);
        }
    }

    @PutMapping("/venta/{id}")
    public ResponseEntity<?> actualizarVenta(@PathVariable Long id, @RequestBody Venta nuevaVenta, HttpServletRequest req) {
        String cid = corrId();
        try {
            Venta v = ventaService.actualizarVenta(id, nuevaVenta);
            Map<String, Object> ok = Map.of(
                    "message", "Venta actualizada correctamente.",
                    "id", v.getId()
            );
            return ResponseEntity.ok()
                    .header("X-Correlation-Id", cid)
                    .body(ok);
        } catch (RuntimeException notFound) {
            logger.warn("[{}] Intento de actualizar venta inexistente id={}", cid, id);
            return error(HttpStatus.NOT_FOUND, "Venta no encontrada.",
                    "No existe una venta con id=" + id, req.getRequestURI(), cid);
        } catch (Exception e) {
            logger.error("[{}] Error al actualizar venta id={}: {}", cid, id, e.getMessage(), e);
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "No se pudo actualizar la venta.",
                    e.getMessage(), req.getRequestURI(), cid);
        }
    }

    @DeleteMapping("/venta/{id}")
    public ResponseEntity<?> eliminarVenta(@PathVariable Long id, HttpServletRequest req) {
        String cid = corrId();
        try {
            boolean eliminado = ventaService.eliminarVenta(id);
            if (!eliminado) {
                logger.warn("[{}] Eliminación fallida; venta no existe id={}", cid, id);
                return error(HttpStatus.NOT_FOUND, "Venta no encontrada.",
                        "No existe una venta con id=" + id, req.getRequestURI(), cid);
            }
            return ResponseEntity.ok()
                    .header("X-Correlation-Id", cid)
                    .body(Map.of("message", "Venta eliminada correctamente.", "id", id));
        } catch (Exception e) {
            logger.error("[{}] Error al eliminar venta id={}: {}", cid, id, e.getMessage(), e);
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "No se pudo eliminar la venta.",
                    e.getMessage(), req.getRequestURI(), cid);
        }
    }

    @DeleteMapping("/ventas-forma-masiva")
    public ResponseEntity<?> eliminarVentas(@RequestBody List<Long> ids, HttpServletRequest req) {
        String cid = corrId();
        try {
            if (ids == null || ids.isEmpty()) {
                logger.warn("[{}] Lista de IDs vacía en eliminación masiva", cid);
                return error(HttpStatus.BAD_REQUEST, "Listado de IDs vacío.",
                        "Debes enviar una lista de IDs para eliminar.", req.getRequestURI(), cid);
            }
            boolean ok = ventaService.eliminarVentas(ids);
            if (!ok) {
                logger.error("[{}] Eliminación masiva fallida para {} IDs", cid, ids.size());
                return error(HttpStatus.INTERNAL_SERVER_ERROR, "No se pudieron eliminar las ventas.",
                        "Ocurrió un error al eliminar en lote.", req.getRequestURI(), cid);
            }
            return ResponseEntity.ok()
                    .header("X-Correlation-Id", cid)
                    .body(Map.of("message", "Ventas eliminadas correctamente.", "deletedCount", ids.size()));
        } catch (Exception e) {
            logger.error("[{}] Error en eliminación masiva: {}", cid, e.getMessage(), e);
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "No se pudieron eliminar las ventas.",
                    e.getMessage(), req.getRequestURI(), cid);
        }
    }

    // ===================== Carga Template General (CU4) =====================

    /**
     * Sube el archivo del Template General (encabezados en Base!B4:N4; datos desde fila 5)
     * y devuelve un .txt con incidencias (si existen) o un resumen OK.
     * Día/Mes/Año se derivan de la columna "MES" (formato dd/MM/yyyy, p.ej. 01/03/2025).
     */
    @PostMapping("/subir-archivo-template-general")
    public ResponseEntity<?> subirArchivoTemplateGeneral(
            @RequestParam("file") MultipartFile file,
            HttpServletRequest req) {
        String cid = corrId();
        logger.info("[{}] Inicio de carga CU4: {}", cid, file != null ? file.getOriginalFilename() : "(null)");

        // Validaciones básicas
        if (file == null || file.isEmpty()) {
            logger.warn("[{}] Archivo vacío o nulo en carga CU4", cid);
            return error(HttpStatus.BAD_REQUEST, "El archivo está vacío.",
                    "Envía un archivo Excel con datos.", req.getRequestURI(), cid);
        }
        if (file.getSize() > MAX_UPLOAD_BYTES) {
            logger.warn("[{}] Archivo excede tamaño permitido: {} bytes", cid, file.getSize());
            return error(HttpStatus.PAYLOAD_TOO_LARGE, "Archivo demasiado grande.",
                    "Tamaño máximo permitido: " + MAX_UPLOAD_BYTES + " bytes.", req.getRequestURI(), cid);
        }

        String filename = Optional.ofNullable(file.getOriginalFilename()).orElse("").toLowerCase(Locale.ROOT);
        if (!(filename.endsWith(".xlsx") || filename.endsWith(".xls"))) {
            logger.warn("[{}] Extensión no soportada: {}", cid, filename);
            return error(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Tipo de archivo no soportado.",
                    "Se espera un Excel (.xlsx o .xls).", req.getRequestURI(), cid);
        }
        String ct = Optional.ofNullable(file.getContentType()).orElse("");
        if (!ct.isBlank() && !CONTENT_TYPES_XLS.contains(ct)) {
            logger.warn("[{}] Content-Type no estándar para Excel: {}", cid, ct);
            // Permitimos continuar; si prefieres bloquear, cambia el return a 415.
        }

        try {
            // Procesar con el service
            Map<String, Object> res = templateGeneralService.cargarTemplateGeneral(
                    file.getInputStream(),
                    file.getOriginalFilename()
            );

            // Armar TXT de incidencias
            String txt = buildIncidenciasTxt(res, file.getOriginalFilename());
            byte[] bytes = txt.getBytes(StandardCharsets.UTF_8);

            String outName = "incidencias_template_general_" +
                    LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")) + ".txt";

            InputStreamResource resource = new InputStreamResource(new ByteArrayInputStream(bytes));

            return ResponseEntity.ok()
                    .header("X-Correlation-Id", cid)
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + outName)
                    .contentType(MediaType.TEXT_PLAIN)
                    .contentLength(bytes.length)
                    .body(resource);

        } catch (IllegalArgumentException iae) {
            logger.warn("[{}] Error de datos en CU4: {}", cid, iae.getMessage());
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "El archivo contiene datos/formatos inválidos.",
                    iae.getMessage(), req.getRequestURI(), cid);
        } catch (Exception e) {
            logger.error("[{}] Error procesando Template General: {}", cid, e.getMessage(), e);
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Error interno al procesar el archivo.",
                    e.getMessage(), req.getRequestURI(), cid);
        }
    }

    @PostMapping("/subir-archivo-template-general/json")
    public ResponseEntity<?> subirArchivoTemplateGeneralJson(
        @RequestParam("file") MultipartFile file,
        HttpServletRequest req
    ) {
        String cid = corrId();
        logger.info("[{}] Inicio de carga CU4 (JSON): {}", cid, file != null ? file.getOriginalFilename() : "(null)");

        if (file == null || file.isEmpty()) {
            logger.warn("[{}] Archivo vacío o nulo en carga CU4 (JSON)", cid);
            return error(HttpStatus.BAD_REQUEST, "El archivo está vacío.",
                    "Envía un archivo Excel con datos.", req.getRequestURI(), cid);
        }
        if (file.getSize() > MAX_UPLOAD_BYTES) {
            logger.warn("[{}] Archivo excede tamaño permitido: {} bytes (JSON)", cid, file.getSize());
            return error(HttpStatus.PAYLOAD_TOO_LARGE, "Archivo demasiado grande.",
                    "Tamaño máximo permitido: " + MAX_UPLOAD_BYTES + " bytes.", req.getRequestURI(), cid);
        }
        String filename = Optional.ofNullable(file.getOriginalFilename()).orElse("").toLowerCase(Locale.ROOT);
        if (!(filename.endsWith(".xlsx") || filename.endsWith(".xls"))) {
            logger.warn("[{}] Extensión no soportada (JSON): {}", cid, filename);
            return error(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Tipo de archivo no soportado.",
                    "Se espera un Excel (.xlsx o .xls).", req.getRequestURI(), cid);
        }

        try {
            Map<String, Object> res = templateGeneralService.cargarTemplateGeneral(
                    file.getInputStream(),
                    file.getOriginalFilename()
            );
            return ResponseEntity.ok()
                    .header("X-Correlation-Id", cid)
                    .body(res);
        } catch (IllegalArgumentException iae) {
            logger.warn("[{}] Error de datos en CU4 (JSON): {}", cid, iae.getMessage());
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "El archivo contiene datos/formatos inválidos.",
                    iae.getMessage(), req.getRequestURI(), cid);
        } catch (Exception e) {
            logger.error("[{}] Error procesando Template General (JSON): {}", cid, e.getMessage(), e);
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Error interno al procesar el archivo.",
                    e.getMessage(), req.getRequestURI(), cid);
        }
    }

    // ===================== Utilidades (filtros / reportes) =====================

    @GetMapping("/marcas-ventas")
    public ResponseEntity<?> obtenerMarcasDisponibles(HttpServletRequest req) {
        String cid = corrId();
        try {
            List<String> marcas = ventaService.obtenerMarcasDisponibles();
            return ResponseEntity.ok()
                    .header("X-Correlation-Id", cid)
                    .body(marcas);
        } catch (Exception e) {
            logger.error("[{}] Error al obtener marcas: {}", cid, e.getMessage(), e);
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "No se pudieron obtener las marcas.",
                    e.getMessage(), req.getRequestURI(), cid);
        }
    }

        @GetMapping("/anios-disponibles")
        public ResponseEntity<?> obtenerAniosDisponibles(
                @RequestParam(required = false) Long clienteId,
                HttpServletRequest req) {

            String cid = corrId();  // <-- con punto y coma

            try {
                List<Integer> anios = ventaService.obtenerAniosDisponibles(clienteId);
                return ResponseEntity.ok()
                        .header("X-Correlation-Id", cid)
                        .body(anios);
            } catch (Exception e) {
                logger.error("[{}] Error al obtener años disponibles: {}", cid, e.getMessage(), e);
                return error(
                        HttpStatus.INTERNAL_SERVER_ERROR,
                        "No se pudieron obtener los años disponibles.",
                        e.getMessage(),
                        req.getRequestURI(),
                        cid
                );
            }
        }



    @GetMapping("/meses-disponibles")
    public ResponseEntity<?> obtenerMesesDisponibles(@RequestParam(required = false) Integer anio,
                                                     @RequestParam(required = false) Long clienteId,
                                                     HttpServletRequest req) {
        String cid = corrId();
        try {
            List<Integer> meses = ventaService.obtenerMesesDisponibles(anio, clienteId);
            return ResponseEntity.ok()
                    .header("X-Correlation-Id", cid)
                    .body(meses);
        } catch (Exception e) {
            logger.error("[{}] Error al obtener meses disponibles: {}", cid, e.getMessage(), e);
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "No se pudieron obtener los meses disponibles.",
                    e.getMessage(), req.getRequestURI(), cid);
        }
    }

    /**
     * Reporte Excel de ventas (general).
     */
    /**
 * Reporte de ventas (general).
 * ✅ MEJORA PEDIDA: en vez de XLSX, devuelve ZIP (CSV) por streaming para no cargar todo en memoria.
 */
@GetMapping("/reporte-ventas")
public ResponseEntity<StreamingResponseBody> generarReporteVentas(
        @RequestParam(value = "anio", required = false) Integer anio,
        @RequestParam(value = "mes", required = false) Integer mes,
        @RequestParam(value = "marca", required = false) String marca
) {
    String filename = "reporte_ventas_template_general_" +
            LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")) + ".zip";

    StreamingResponseBody body = outputStream ->
            ventaService.escribirReporteVentasZip(outputStream, anio, mes, marca);

    return ResponseEntity.ok()
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + filename)
            .contentType(MediaType.APPLICATION_OCTET_STREAM)
            .body(body);
}


    @GetMapping("/reporte-ventas-zip")
    public ResponseEntity<StreamingResponseBody> generarReporteVentasZip(
            @RequestParam(value = "anio", required = false) Integer anio,
            @RequestParam(value = "mes", required = false) Integer mes,
            @RequestParam(value = "marca", required = false) String marca
    ) {
        String filename = "template_general_ventas_" +
                LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")) + ".zip";

        StreamingResponseBody body = outputStream ->
                ventaService.escribirReporteVentasZip(outputStream, anio, mes, marca);

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + filename)
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(body);
    }


    // ===================== Helpers =====================

    private String buildIncidenciasTxt(Map<String, Object> res, String nombreArchivo) {
        String nl = System.lineSeparator();
        StringBuilder sb = new StringBuilder();

        // Portada
        sb.append("INCIDENCIAS DETECTADAS - TEMPLATE GENERAL (CU4)").append(nl);
        sb.append("Archivo: ").append(nombreArchivo).append(nl);
        sb.append("Generado: ")
        .append(LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")))
        .append(nl);
        sb.append("----").append(nl);

        // Resumen
        sb.append("[RESUMEN]").append(nl);
        sb.append("ok=").append(res.getOrDefault("ok", false)).append(nl);
        sb.append("filasLeidas=").append(res.getOrDefault("filasLeidas", 0)).append(nl);
        sb.append("filasConCodCliente=").append(res.getOrDefault("filasConCodCliente", 0)).append(nl);
        sb.append("insertados=").append(res.getOrDefault("insertados", 0)).append(nl);
        sb.append("actualizados=").append(res.getOrDefault("actualizados", 0)).append(nl);
        sb.append("omitidos=").append(res.getOrDefault("omitidos", 0)).append(nl);
        sb.append("errores=").append(res.getOrDefault("errores", 0)).append(nl);
        sb.append("----").append(nl).append(nl);

        // Errores/advertencias generales
        sb.append("[INCIDENCIAS GENERALES]").append(nl);
        Object inc = res.get("incidencias");
        if (inc instanceof List<?> lst && !lst.isEmpty()) {
            for (Object it : lst) sb.append("- ").append(String.valueOf(it)).append(nl);
        } else {
            sb.append("Sin incidencias.").append(nl);
        }
        sb.append(nl);

        // Detalle: Omitidos
        sb.append("[DETALLE DE FILAS OMITIDAS]").append(nl);
        List<?> omitidos = (List<?>) res.getOrDefault("detalleOmitidos", List.of());
        if (omitidos.isEmpty()) {
            sb.append("Sin filas omitidas.").append(nl);
        } else {
            sb.append("Fila\tCODBARRA\tCOD_PDV\tMotivo").append(nl);
            for (Object o : omitidos) {
                if (o instanceof Map<?, ?> m) {
                    sb.append(Objects.toString(m.get("fila"), ""))
                    .append('\t').append(Objects.toString(m.get("codBarra"), ""))
                    .append('\t').append(Objects.toString(m.get("codPdv"), ""))
                    .append('\t').append(Objects.toString(m.get("motivo"), ""))
                    .append(nl);
                }
            }
        }
        sb.append(nl);

        // Detalle: Insertados
        sb.append("[DETALLE DE FILAS INSERTADAS]").append(nl);
        List<?> insertados = (List<?>) res.getOrDefault("detalleInsertados", List.of());
        if (insertados.isEmpty()) {
            sb.append("Sin filas insertadas.").append(nl);
        } else {
            sb.append("Fila\tCODBARRA\tCOD_PDV\tVentaUnd\tVentaUSD").append(nl);
            for (Object o : insertados) {
                if (o instanceof Map<?, ?> m) {
                    sb.append(Objects.toString(m.get("fila"), ""))
                    .append('\t').append(Objects.toString(m.get("codBarra"), ""))
                    .append('\t').append(Objects.toString(m.get("codPdv"), ""))
                    .append('\t').append(Objects.toString(m.get("ventaUnidades"), ""))
                    .append('\t').append(Objects.toString(m.get("ventaUSD"), ""))
                    .append(nl);
                }
            }
        }
        sb.append(nl);

        // Detalle: Actualizados
        sb.append("[DETALLE DE FILAS ACTUALIZADAS]").append(nl);
        List<?> actualizados = (List<?>) res.getOrDefault("detalleActualizados", List.of());
        if (actualizados.isEmpty()) {
            sb.append("Sin filas actualizadas.").append(nl);
        } else {
            sb.append("Fila\tCODBARRA\tCOD_PDV\tVentaUnd\tVentaUSD").append(nl);
            for (Object o : actualizados) {
                if (o instanceof Map<?, ?> m) {
                    sb.append(Objects.toString(m.get("fila"), ""))
                    .append('\t').append(Objects.toString(m.get("codBarra"), ""))
                    .append('\t').append(Objects.toString(m.get("codPdv"), ""))
                    .append('\t').append(Objects.toString(m.get("ventaUnidades"), ""))
                    .append('\t').append(Objects.toString(m.get("ventaUSD"), ""))
                    .append(nl);
                }
            }
        }
        sb.append(nl);

        // Listado de códigos afectados
        sb.append("[CÓDIGOS AFECTADOS EN ESTA CARGA (CODBARRA)]").append(nl);
        List<?> codigos = (List<?>) res.getOrDefault("codigosAfectados", List.of());
        if (codigos.isEmpty()) {
            sb.append("Ninguno.").append(nl);
        } else {
            for (Object c : codigos) sb.append("- ").append(String.valueOf(c)).append(nl);
        }

        return sb.toString();
    }

    private ResponseEntity<Map<String, Object>> error(HttpStatus status, String message, String details,
                                                      String path, String correlationId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", LocalDateTime.now().toString());
        body.put("status", status.value());
        body.put("error", status.getReasonPhrase());
        body.put("message", message);
        if (details != null && !details.isBlank()) {
            body.put("details", details);
        }
        body.put("path", path);
        body.put("correlationId", correlationId);
        return ResponseEntity.status(status)
                .header("X-Correlation-Id", correlationId)
                .contentType(MediaType.APPLICATION_JSON)
                .body(body);
    }

    private String corrId() {
        return UUID.randomUUID().toString();
    }
}
