package com.manamer.backend.business.sellout.controller;

import com.manamer.backend.business.sellout.models.Cliente;
import com.manamer.backend.business.sellout.models.ExcelUtils;
import com.manamer.backend.business.sellout.models.Producto;
import com.manamer.backend.business.sellout.models.TipoMueble;
import com.manamer.backend.business.sellout.models.Venta;
import com.manamer.backend.business.sellout.service.ClienteService;
import com.manamer.backend.business.sellout.service.DepratiVentaService;
import com.manamer.backend.business.sellout.service.ProductoService;
import com.manamer.backend.business.sellout.service.TipoMuebleService;
import com.manamer.backend.business.sellout.service.VentaService;

import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.dao.DataIntegrityViolationException;

import java.io.IOException;
import java.text.Normalizer;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@CrossOrigin(
        origins = "*",
        allowedHeaders = "*",
        methods = {RequestMethod.GET, RequestMethod.POST, RequestMethod.PUT, RequestMethod.DELETE}
)
@RequestMapping("/api-sellout/deprati")
public class DepratiController {

    // ======== Estructura y constantes (no afectan tus endpoints) ========
    private static final Logger logger = LoggerFactory.getLogger(DepratiController.class);
    private static final String COD_CLIENTE_DEPRATI = "MZCL-000009";

    // ======== Helpers estilo Fybeca (no cambian tus llamadas) ========
    private static String resolveCodCliente(String codCliente) {
        return (codCliente == null || codCliente.trim().isEmpty()) ? COD_CLIENTE_DEPRATI : codCliente.trim();
    }

    private static <T> List<List<T>> partition(List<T> list, int size) {
        List<List<T>> parts = new ArrayList<>();
        if (list == null || list.isEmpty() || size <= 0) return parts;
        for (int i = 0; i < list.size(); i += size) parts.add(list.subList(i, Math.min(i + size, list.size())));
        return parts;
    }

    public static String normalizarTexto(String input) {
        if (input == null) return null;
        return Normalizer.normalize(input.toLowerCase().trim(), Normalizer.Form.NFD)
                .replaceAll("\\p{InCombiningDiacriticalMarks}+", "")
                .replaceAll("[^\\p{ASCII}]", "")
                .replaceAll("[\\.,\"']", "");
    }

    private Workbook obtenerWorkbookCorrecto(MultipartFile file) throws IOException {
        String nombreArchivo = file.getOriginalFilename();
        if (nombreArchivo != null && nombreArchivo.toLowerCase().endsWith(".xls")) {
            return new HSSFWorkbook(file.getInputStream());
        } else {
            return new XSSFWorkbook(file.getInputStream());
        }
    }

    private <T> T obtenerValorCelda(Cell cell, Class<T> clazz) {
        if (cell == null) {
            if (clazz == Integer.class) return clazz.cast(0);
            if (clazz == Double.class) return clazz.cast(0.0);
            return null;
        }
        try {
            switch (cell.getCellType()) {
                case NUMERIC:
                    if (clazz == Integer.class) return clazz.cast((int) cell.getNumericCellValue());
                    if (clazz == Double.class) return clazz.cast(cell.getNumericCellValue());
                    if (clazz == String.class) return clazz.cast(String.valueOf((int) cell.getNumericCellValue()));
                    break;
                case STRING:
                    String value = cell.getStringCellValue().trim();
                    if (clazz == Integer.class) {
                        try { return clazz.cast(Integer.parseInt(value)); } catch (NumberFormatException e) { return clazz.cast(0); }
                    } else if (clazz == Double.class) {
                        try { return clazz.cast(Double.parseDouble(value)); } catch (NumberFormatException e) { return clazz.cast(0.0); }
                    } else {
                        return clazz.cast(value);
                    }
                case BLANK:
                    if (clazz == Integer.class) return clazz.cast(0);
                    if (clazz == Double.class) return clazz.cast(0.0);
                    return null;
                default:
                    if (clazz == Integer.class) return clazz.cast(0);
                    if (clazz == Double.class) return clazz.cast(0.0);
                    return null;
            }
        } catch (Exception e) {
            logger.error("Error al convertir celda: {}", cell, e);
            if (clazz == Integer.class) return clazz.cast(0);
            if (clazz == Double.class) return clazz.cast(0.0);
        }
        return null;
    }

    // ======== Services ========
    private final DepratiVentaService depratiVentaService;
    private final TipoMuebleService tipoMuebleService;
    private final ClienteService clienteService;
    private final ProductoService productoService;
    private final VentaService ventaService;

    @Autowired
    public DepratiController(DepratiVentaService depratiVentaService,
                             TipoMuebleService tipoMuebleService,
                             ClienteService clienteService,
                             ProductoService productoService,
                             VentaService ventaService) {
        this.depratiVentaService = depratiVentaService;
        this.tipoMuebleService = tipoMuebleService;
        this.clienteService = clienteService;
        this.productoService = productoService;
        this.ventaService = ventaService;
    }

    // ===================== VENTAS (SIN CAMBIOS) =====================
    @GetMapping("/venta")
    public ResponseEntity<List<Venta>> obtenerTodasLasVentas() {
        return ResponseEntity.ok(depratiVentaService.obtenerTodasLasVentasDeprati());
    }

    @GetMapping("/venta/{id}")
    public ResponseEntity<Venta> obtenerVentaPorId(@PathVariable Long id) {
        return depratiVentaService.obtenerVentaDepratiPorId(id)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping("/venta/{id}")
    public ResponseEntity<Venta> actualizarVenta(@PathVariable Long id, @RequestBody Venta nuevaVenta) {
        try {
            var actualizada = depratiVentaService.actualizarVentaDeprati(id, nuevaVenta);
            return ResponseEntity.ok(actualizada);
        } catch (RuntimeException e) {
            logger.warn("No se pudo actualizar venta {}: {}", id, e.getMessage());
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
    }

    @DeleteMapping("/venta/{id}")
    public ResponseEntity<Void> eliminarVenta(@PathVariable Long id) {
        boolean ok = depratiVentaService.eliminarVentaDeprati(id);
        return ok ? ResponseEntity.noContent().build()
                  : ResponseEntity.status(HttpStatus.NOT_FOUND).build();
    }

    @DeleteMapping("/ventas-forma-masiva")
    public ResponseEntity<Void> eliminarVentas(@RequestBody List<Long> ids) {
        boolean ok = depratiVentaService.eliminarVentasDeprati(ids);
        return ok ? ResponseEntity.ok().build()
                  : ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
    }

    // ===================== CARGAS EXCEL (SIN CAMBIOS) =====================
    @PostMapping("/subir-archivos-motor-maping")
    public ResponseEntity<Map<String, Object>> procesarArchivoExcelFlexible(
            @RequestParam("file") MultipartFile file) {

        return depratiVentaService.procesarArchivoExcelFlexible(file);
    }

    @PostMapping("/subir-archivo-venta")
    public ResponseEntity<Map<String, Object>> procesarArchivoExcelDeprati(
            @RequestParam("file") MultipartFile file) {

        return depratiVentaService.procesarArchivoExcelDeprati(file);
    }


    // ===================== TIPO DE MUEBLE (SIN CAMBIOS) =====================
    private void ensureClienteDeprati(TipoMueble tm) {
        if (tm == null) return;
        var cliente = clienteService.findByCodCliente(COD_CLIENTE_DEPRATI)
                .orElseThrow(() -> new IllegalStateException("Cliente DePrati no configurado"));
        if (tm.getCliente() == null ||
            !COD_CLIENTE_DEPRATI.equals(
                Optional.ofNullable(tm.getCliente().getCodCliente()).orElse(null))) {
            tm.setCliente(cliente);
        }
    }

    @GetMapping("/tipo-mueble")
    public ResponseEntity<List<TipoMueble>> obtenerTiposMuebleDeprati(
            @RequestParam(value = "codCliente", required = false) String ignoradoParaCompat) {
        return ResponseEntity.ok(tipoMuebleService.obtenerTodosLosTiposMuebleDeprati());
    }

    @GetMapping("/tipo-mueble/{id}")
    public ResponseEntity<?> obtenerTipoMueblePorId(@PathVariable Long id) {
        return tipoMuebleService.obtenerTipoMueblePorId(id)
                .filter(tm -> tm.getCliente() != null &&
                        COD_CLIENTE_DEPRATI.equals(tm.getCliente().getCodCliente()))
                .<ResponseEntity<?>>map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("message", "No existe o no pertenece a DePrati")));
    }

    @PostMapping(
            value = "/tipo-mueble",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    public ResponseEntity<?> crearTipoMueble(@RequestBody TipoMueble tipoMueble) {
        try {
            ensureClienteDeprati(tipoMueble);
            var creado = tipoMuebleService.guardarTipoMueble(tipoMueble);
            return ResponseEntity.status(HttpStatus.CREATED).body(creado);
        } catch (DataIntegrityViolationException ex) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(Map.of("message", "Ya existe un tipo de mueble con esos datos."));
        } catch (IllegalArgumentException ex) {
            return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
        } catch (Exception ex) {
            logger.error("Error al crear tipo de mueble", ex);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "No se pudo crear el tipo de mueble."));
        }
    }

    @PutMapping(
            value = "/tipo-mueble/{id}",
            consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    public ResponseEntity<?> actualizarTipoMueble(@PathVariable Long id, @RequestBody TipoMueble nuevo) {
        try {
            var existente = tipoMuebleService.obtenerTipoMueblePorId(id).orElse(null);
            if (existente == null || existente.getCliente() == null ||
                    !COD_CLIENTE_DEPRATI.equals(existente.getCliente().getCodCliente())) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("message", "No existe o no pertenece a DePrati"));
            }
            ensureClienteDeprati(nuevo);
            var actualizado = tipoMuebleService.actualizarTipoMueble(id, nuevo);
            return ResponseEntity.ok(actualizado);
        } catch (DataIntegrityViolationException ex) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(Map.of("message", "Conflicto al actualizar (duplicado)."));
        } catch (RuntimeException ex) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("message", ex.getMessage()));
        } catch (Exception ex) {
            logger.error("Error al actualizar tipo de mueble", ex);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "No se pudo actualizar el tipo de mueble."));
        }
    }

    @DeleteMapping("/tipo-mueble/{id}")
    public ResponseEntity<?> eliminarTipoMueble(@PathVariable Long id) {
        var tm = tipoMuebleService.obtenerTipoMueblePorId(id).orElse(null);
        if (tm == null || tm.getCliente() == null ||
                !COD_CLIENTE_DEPRATI.equals(tm.getCliente().getCodCliente())) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("message", "No existe o no pertenece a DePrati"));
        }
        boolean ok = tipoMuebleService.eliminarTipoMueble(id);
        return ok ? ResponseEntity.noContent().build()
                  : ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "No se pudo eliminar el tipo de mueble."));
    }

    @DeleteMapping(
            value = "/eliminar-varios-tipo-mueble",
            consumes = MediaType.APPLICATION_JSON_VALUE
    )
    public ResponseEntity<?> eliminarTiposMuebleDeprati(@RequestBody List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "Debe enviar IDs a eliminar."));
        }
        List<Long> idsDeprati = new ArrayList<>();
        for (Long id : ids) {
            tipoMuebleService.obtenerTipoMueblePorId(id).ifPresent(tm -> {
                if (tm.getCliente() != null &&
                    COD_CLIENTE_DEPRATI.equals(tm.getCliente().getCodCliente())) {
                    idsDeprati.add(id);
                }
            });
        }
        if (idsDeprati.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(Map.of("message", "No hay tipos de mueble de DePrati en la selección."));
        }
        boolean ok = tipoMuebleService.eliminarTiposMueble(idsDeprati);
        return ok ? ResponseEntity.ok().build()
                  : ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "No se pudieron eliminar los registros seleccionados."));
    }

    @PostMapping(
            value = "/template-tipo-muebles",
            consumes = MediaType.MULTIPART_FORM_DATA_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE
    )
    public ResponseEntity<?> subirTemplateTipoMuebles(@RequestPart("file") MultipartFile file) {
        try {
            if (file == null || file.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of("message", "El archivo está vacío."));
            }
            var guardados = tipoMuebleService.cargarTipoMueblesDesdeArchivoDeprati(file);
            Map<String, Object> resp = new HashMap<>();
            resp.put("message", "Archivo procesado correctamente.");
            resp.put("insertados", guardados.size());
            return ResponseEntity.ok(resp);
        } catch (IllegalArgumentException ex) {
            return ResponseEntity.badRequest().body(Map.of("message", ex.getMessage()));
        } catch (Exception ex) {
            logger.error("Error al subir tipo de mueble (DePrati)", ex);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "Error al procesar el archivo."));
        }
    }

    // ===================== REPORTE (SIN CAMBIOS) =====================
    @GetMapping("/reporte-tipo-mueble")
    public ResponseEntity<Resource> reporteTipoMueble() {
        try {
            var wb = new org.apache.poi.xssf.usermodel.XSSFWorkbook();
            var sheet = wb.createSheet("TipoMueble");
            int rowIdx = 0;

            var header = sheet.createRow(rowIdx++);
            String[] cols = {"ID","CodCliente","NombreCliente","Ciudad","CodPDV","NombrePDV","TipoMuebleEssence","Marca"};
            for (int i = 0; i < cols.length; i++) header.createCell(i).setCellValue(cols[i]);

            var data = tipoMuebleService.obtenerTodosLosTiposMuebleDeprati();
            for (var tm : data) {
                var r = sheet.createRow(rowIdx++);
                r.createCell(0).setCellValue(tm.getId() != null ? tm.getId() : 0);
                r.createCell(1).setCellValue(tm.getCliente()!=null? String.valueOf(tm.getCliente().getCodCliente()):"");
                r.createCell(2).setCellValue(tm.getCliente()!=null? String.valueOf(tm.getCliente().getNombreCliente()):"");
                r.createCell(3).setCellValue(tm.getCiudad()!=null? tm.getCiudad():"");
                r.createCell(4).setCellValue(tm.getCodPdv()!=null? tm.getCodPdv():"");
                r.createCell(5).setCellValue(tm.getNombrePdv()!=null? tm.getNombrePdv():"");
                r.createCell(6).setCellValue(tm.getTipoMuebleEssence()!=null? tm.getTipoMuebleEssence():"");
                r.createCell(7).setCellValue(tm.getMarca()!=null? tm.getMarca():"");
            }
            for (int i = 0; i < cols.length; i++) sheet.autoSizeColumn(i);

            var baos = new java.io.ByteArrayOutputStream();
            wb.write(baos);
            wb.close();
            byte[] bytes = baos.toByteArray();

            var resource = new org.springframework.core.io.InputStreamResource(new java.io.ByteArrayInputStream(bytes));
            String filename = "reporte_tipo_mueble.xlsx";
            return ResponseEntity.ok()
                    .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + filename)
                    .contentType(org.springframework.http.MediaType.APPLICATION_OCTET_STREAM)
                    .contentLength(bytes.length)
                    .body(resource);

        } catch (Exception ex) {
            logger.error("Error generando reporte de tipo mueble", ex);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    // ===================== DESCARGABLES (SIN CAMBIOS) =====================
    @PostMapping("/descargas/codigos-no-encontrados")
    public ResponseEntity<Resource> descargarCodigosNoEncontrados(@RequestBody List<String> codigos) {
        return ventaService.obtenerArchivoCodigosNoEncontrados(codigos);
    }

    @PostMapping("/descargas/log-carga")
    public ResponseEntity<Resource> descargarLogCarga(@RequestBody Map<String, Object> resumen) {
        StringBuilder sb = new StringBuilder();
        sb.append("LOG DE CARGA - DEPRATI").append(System.lineSeparator());
        sb.append("Archivo: ").append(resumen.getOrDefault("archivo", "N/D")).append(System.lineSeparator());
        sb.append("Filas leídas: ").append(resumen.getOrDefault("filasLeidas", 0)).append(System.lineSeparator());
        sb.append("Filas procesadas: ").append(resumen.getOrDefault("filasProcesadas", 0)).append(System.lineSeparator());
        sb.append("Insertados: ").append(resumen.getOrDefault("insertados", 0)).append(System.lineSeparator());
        sb.append("Actualizados: ").append(resumen.getOrDefault("actualizados", 0)).append(System.lineSeparator());
        sb.append("Omitidos: ").append(resumen.getOrDefault("omitidos", 0)).append(System.lineSeparator());
        sb.append("Errores: ").append(resumen.getOrDefault("errores", 0)).append(System.lineSeparator());

        Object inc = resumen.get("incidencias");
        if (inc instanceof Collection<?> col && !col.isEmpty()) {
            sb.append(System.lineSeparator()).append("Incidencias:").append(System.lineSeparator());
            for (Object o : col) {
                sb.append("- ").append(String.valueOf(o)).append(System.lineSeparator());
            }
        }

        byte[] bytes = sb.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
        var resource = new org.springframework.core.io.InputStreamResource(new java.io.ByteArrayInputStream(bytes));
        String filename = "log_carga_deprati_" +
                LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")) + ".txt";

        return ResponseEntity.ok()
                .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + filename)
                .contentType(org.springframework.http.MediaType.TEXT_PLAIN)
                .contentLength(bytes.length)
                .body(resource);
    }
}
