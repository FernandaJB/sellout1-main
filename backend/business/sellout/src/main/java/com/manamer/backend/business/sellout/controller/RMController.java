package com.manamer.backend.business.sellout.controller;

import com.manamer.backend.business.sellout.models.Venta;
import com.manamer.backend.business.sellout.service.RMService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@RestController
@CrossOrigin(origins = "*", allowedHeaders = "*")
@RequestMapping("/api-sellout/rm")
public class RMController {

    private static final Logger log = LoggerFactory.getLogger(RMController.class);

    private final RMService rmService;

    private static final String DEFAULT_COD_CLIENTE = "MZCL-000008";

    @Autowired
    public RMController(RMService rmService) {
        this.rmService = rmService;
    }

    // ==========================================================
    //  POST /api/RM-subir-archivo-venta
    //  Procesa hojas: VENTAS y STOCK + opcional TXT incidencias
    // ==========================================================
    @PostMapping("/subir-archivo-venta")
    public ResponseEntity<?> subirArchivoVentaRM(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "codCliente", required = false) String codCliente,
            @RequestParam(value = "txt", required = false, defaultValue = "false") boolean txt
    ) {
        String nombre = (file != null && file.getOriginalFilename() != null) ? file.getOriginalFilename() : "archivo.xlsx";

        log.info("==================================================");
        log.info("[RM] INICIO CARGA EXCEL");
        log.info("[RM] Archivo='{}' size={} bytes codClienteParam='{}' txt={}",
                nombre, (file != null ? file.getSize() : -1), codCliente, txt);

        if (file == null || file.isEmpty()) {
            log.warn("[RM] Archivo nulo o vacío.");
            return ResponseEntity.badRequest().body(Map.of(
                    "ok", false,
                    "error", "El archivo está vacío o es nulo."
            ));
        }

        try {
            Map<String, Object> res = (codCliente == null || codCliente.isBlank())
                    ? rmService.cargarExcelRM(file.getInputStream(), nombre)
                    : rmService.cargarExcelRM(file.getInputStream(), codCliente.trim(), nombre);

            Object ok = res.getOrDefault("ok", false);
            int leidasV = asInt(res.getOrDefault("filasLeidasVentas", 0));
            int procV   = asInt(res.getOrDefault("filasProcesadasVentas", 0));
            int leidasS = asInt(res.getOrDefault("filasLeidasStock", 0));
            int procS   = asInt(res.getOrDefault("filasProcesadasStock", 0));
            int noEnc   = sizeOfList(res.get("codigosNoEncontrados"));
            int inci    = sizeOfList(res.get("incidencias"));

            log.info("[RM] FIN CARGA EXCEL ok={}", ok);
            log.info("[RM] Ventas -> leídas={} procesadas={}", leidasV, procV);
            log.info("[RM] Stock  -> leídas={} procesadas={}", leidasS, procS);
            log.info("[RM] codigosNoEncontrados={} incidencias={}", noEnc, inci);
            log.info("[RM] tiempoSegundos={}", res.getOrDefault("tiempoSegundos", 0));
            log.info("==================================================");

            if (txt) {
                log.info("[RM] Respondiendo TXT de incidencias.");
                return rmService.generarIncidenciasTxt(nombre, res);
            }

            log.info("[RM] Respondiendo JSON.");
            return ResponseEntity.ok(res);

        } catch (Exception e) {
            log.error("[RM] ERROR procesando archivo: {}", e.getMessage(), e);
            return ResponseEntity.badRequest().body(Map.of(
                    "ok", false,
                    "error", "Error al procesar archivo: " + e.getMessage()
            ));
        }
    }

    // ==========================================================
    //  GET /api/rm/ventas
    //  Listado paginado + filtros
    // ==========================================================
    @GetMapping("/ventas")
    public ResponseEntity<?> obtenerVentasRM(
            @RequestParam(value = "codCliente", required = false) String codCliente,
            @RequestParam(value = "anio", required = false) Integer anio,
            @RequestParam(value = "mes", required = false) Integer mes,
            @RequestParam(value = "marca", required = false) String marca,
            @RequestParam(value = "limit", required = false) Integer limit,
            @RequestParam(value = "offset", required = false) Integer offset
    ) {
        try {
            log.info("[RM] GET /ventas codCliente={} anio={} mes={} marca={} limit={} offset={}",
                    codCliente, anio, mes, marca, limit, offset);

            // ✅ Firmas disponibles en RMService:
            // - obtenerVentasResumen(Integer anio, Integer mes, String marca, Integer limit, Integer offset)
            // - obtenerVentasResumenPorCodCliente(String codCliente, Integer anio, Integer mes, String marca, Integer limit, Integer offset)
            String cod = resolveCodCliente(codCliente);

            List<Map<String, Object>> ventas = rmService.obtenerVentasTodasPorCodCliente(cod, anio, mes, marca);

            return ResponseEntity.ok(ventas);

        } catch (Exception e) {
            log.error("[RM] ERROR /ventas: {}", e.getMessage(), e);
            return ResponseEntity.badRequest().body(Map.of(
                    "ok", false,
                    "error", "Error al obtener ventas: " + e.getMessage()
            ));
        }
    }

    // ==========================================================
    //  GET /api/rm/venta/{id}
    // ==========================================================
    @GetMapping("/venta/{id}")
    public ResponseEntity<?> obtenerVentaRMPorId(
            @PathVariable("id") Long id,
            @RequestParam(value = "codCliente", required = false) String codCliente
    ) {
        try {
            log.info("[RM] GET /venta/{} codCliente={}", id, codCliente);

            // ✅ Firmas disponibles en RMService:
            // - obtenerVentaPorId(Long id)
            // - obtenerVentaPorIdYCodCliente(Long id, String codCliente)
            Optional<Venta> v = (codCliente == null || codCliente.isBlank())
                    ? rmService.obtenerVentaPorId(id)
                    : rmService.obtenerVentaPorIdYCodCliente(id, codCliente.trim());

            if (v.isEmpty()) {
                log.warn("[RM] Venta no encontrada id={} codCliente={}", id, codCliente);
                return ResponseEntity.status(404).body(Map.of(
                        "ok", false,
                        "error", "Venta no encontrada",
                        "id", id
                ));
            }
            return ResponseEntity.ok(v.get());

        } catch (Exception e) {
            log.error("[RM] ERROR /venta/{}: {}", id, e.getMessage(), e);
            return ResponseEntity.badRequest().body(Map.of(
                    "ok", false,
                    "error", "Error al obtener venta: " + e.getMessage()
            ));
        }
    }

    // ==========================================================
    //  PUT /api/rm/venta/{id}
    // ==========================================================
    @PutMapping("/venta/{id}")
    public ResponseEntity<?> actualizarVentaRM(
            @PathVariable("id") Long id,
            @RequestParam(value = "codCliente", required = false) String codCliente,
            @RequestBody Venta nuevaVenta
    ) {
        try {
            log.info("[RM] PUT /venta/{} codCliente={}", id, codCliente);

            // ✅ Firmas disponibles en RMService:
            // - actualizarVenta(Long id, Venta nuevaVenta)
            // - actualizarVentaPorCodCliente(Long id, String codCliente, Venta nuevaVenta)
            Venta v = (codCliente == null || codCliente.isBlank())
                    ? rmService.actualizarVenta(id, nuevaVenta)
                    : rmService.actualizarVentaPorCodCliente(id, codCliente.trim(), nuevaVenta);

            log.info("[RM] Venta actualizada id={}", v.getId());
            return ResponseEntity.ok(Map.of(
                    "ok", true,
                    "message", "Venta actualizada correctamente.",
                    "id", v.getId()
            ));

        } catch (RuntimeException notFound) {
            log.warn("[RM] No encontrada para actualizar id={} msg={}", id, notFound.getMessage());
            return ResponseEntity.status(404).body(Map.of(
                    "ok", false,
                    "error", notFound.getMessage()
            ));
        } catch (Exception e) {
            log.error("[RM] ERROR actualizando venta id={}: {}", id, e.getMessage(), e);
            return ResponseEntity.badRequest().body(Map.of(
                    "ok", false,
                    "error", "Error al actualizar venta: " + e.getMessage()
            ));
        }
    }

    // ==========================================================
    //  DELETE /api/rm/venta/{id}
    // ==========================================================
    @DeleteMapping("/venta/{id}")
    public ResponseEntity<?> eliminarVentaRM(
            @PathVariable("id") Long id,
            @RequestParam(value = "codCliente", required = false) String codCliente
    ) {
        try {
            log.info("[RM] DELETE /venta/{} codCliente={}", id, codCliente);

            // ✅ Firmas disponibles en RMService:
            // - eliminarVenta(Long id)
            // - eliminarVentaPorCodCliente(Long id, String codCliente)
            boolean ok = (codCliente == null || codCliente.isBlank())
                    ? rmService.eliminarVenta(id)
                    : rmService.eliminarVentaPorCodCliente(id, codCliente.trim());

            if (!ok) {
                log.warn("[RM] Venta no encontrada para eliminar id={} codCliente={}", id, codCliente);
                return ResponseEntity.status(404).body(Map.of(
                        "ok", false,
                        "error", "Venta no encontrada para eliminar",
                        "id", id
                ));
            }

            log.info("[RM] Venta eliminada id={}", id);
            return ResponseEntity.ok(Map.of(
                    "ok", true,
                    "message", "Venta eliminada correctamente.",
                    "id", id
            ));

        } catch (Exception e) {
            log.error("[RM] ERROR eliminando venta id={}: {}", id, e.getMessage(), e);
            return ResponseEntity.badRequest().body(Map.of(
                    "ok", false,
                    "error", "Error al eliminar venta: " + e.getMessage()
            ));
        }
    }

    // ==========================================================
    //  DELETE /api/rm/ventas-forma-masiva
    // ==========================================================
    @DeleteMapping("/ventas-forma-masiva")
    public ResponseEntity<?> eliminarVentasRMMasivo(
            @RequestBody List<Long> ids,
            @RequestParam(value = "codCliente", required = false) String codCliente
    ) {
        try {
            log.info("[RM] DELETE /ventas-forma-masiva codCliente={} idsCount={}",
                    codCliente, (ids != null ? ids.size() : 0));

            if (ids == null || ids.isEmpty()) {
                log.warn("[RM] Lista de IDs vacía en eliminación masiva.");
                return ResponseEntity.badRequest().body(Map.of(
                        "ok", false,
                        "error", "Debes enviar una lista de IDs."
                ));
            }

            // ✅ Firma disponible en RMService:
            // - eliminarVentasMasivo(List<Long> ids) -> Map<String, Object>
            Map<String, Object> out = rmService.eliminarVentasMasivo(ids);

            log.info("[RM] Eliminación masiva completada solicitados={} deletedCount={} omitidos={} ok={}",
                    ids.size(),
                    out.getOrDefault("deletedCount", 0),
                    out.getOrDefault("omitidos", 0),
                    out.getOrDefault("ok", false));

            return ResponseEntity.ok(out);

        } catch (Exception e) {
            log.error("[RM] ERROR eliminación masiva: {}", e.getMessage(), e);
            return ResponseEntity.badRequest().body(Map.of(
                    "ok", false,
                    "error", "Error en eliminación masiva: " + e.getMessage()
            ));
        }
    }

    // ==========================================================
    //  Helpers
    private static String resolveCodCliente(String codCliente) {
        if (codCliente == null) return DEFAULT_COD_CLIENTE;
        String c = codCliente.trim();
        return c.isBlank() ? DEFAULT_COD_CLIENTE : c;
    }
    // ==========================================================
    private static int asInt(Object v) {
        if (v == null) return 0;
        if (v instanceof Number n) return n.intValue();
        try { return Integer.parseInt(String.valueOf(v)); } catch (Exception e) { return 0; }
    }

    private static int sizeOfList(Object v) {
        if (v == null) return 0;
        if (v instanceof List<?> l) return l.size();
        return 0;
    }
}
