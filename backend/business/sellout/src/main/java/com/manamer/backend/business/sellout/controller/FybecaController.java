package com.manamer.backend.business.sellout.controller;

import com.manamer.backend.business.sellout.models.Cliente;
import com.manamer.backend.business.sellout.models.Producto;
import com.manamer.backend.business.sellout.models.TipoMueble;
import com.manamer.backend.business.sellout.models.Venta;
import com.manamer.backend.business.sellout.repositories.VentaRepository;
import com.manamer.backend.business.sellout.service.ClienteService;
import com.manamer.backend.business.sellout.service.FybecaReportService;
import com.manamer.backend.business.sellout.service.FybecaVentaService;
import com.manamer.backend.business.sellout.service.ProductoService;
import com.manamer.backend.business.sellout.service.TipoMuebleService;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import java.io.InputStream;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@CrossOrigin(origins = "*", allowedHeaders = "*", methods = {RequestMethod.GET, RequestMethod.POST, RequestMethod.PUT, RequestMethod.DELETE})
@RequestMapping("/api-sellout/fybeca")
public class FybecaController {

    private static final String DEFAULT_COD_CLIENTE = "MZCL-000014";
    private static final int DELETE_BATCH_SIZE = 5000;

    private static final Logger logger = LoggerFactory.getLogger(FybecaController.class);

    private final FybecaVentaService fybecaService;
    private final FybecaReportService fybecaReportService;
    private final TipoMuebleService tipoMuebleService;
    private final ClienteService clienteService;
    private final ProductoService productoService;
    private final VentaRepository ventaRepository;

    @Autowired
    public FybecaController(FybecaVentaService fybecaService,
                            FybecaReportService fybecaReportService,
                            TipoMuebleService tipoMuebleService,
                            ClienteService clienteService,
                            ProductoService productoService,
                            VentaRepository ventaRepository) {
        this.fybecaService = fybecaService;
        this.fybecaReportService = fybecaReportService;
        this.tipoMuebleService = tipoMuebleService;
        this.clienteService = clienteService;
        this.productoService = productoService;
        this.ventaRepository = ventaRepository;
    }

    // ---------- Helpers ----------
    private static String resolveCodCliente(String codCliente) {
        return (codCliente == null || codCliente.trim().isEmpty()) ? DEFAULT_COD_CLIENTE : codCliente.trim();
    }

    private static <T> List<List<T>> partition(List<T> list, int size) {
        List<List<T>> parts = new ArrayList<>();
        if (list == null || list.isEmpty() || size <= 0) return parts;
        for (int i = 0; i < list.size(); i += size) {
            parts.add(list.subList(i, Math.min(i + size, list.size())));
        }
        return parts;
    }

    // ---------- Ventas ----------
    @GetMapping("/venta")
    public ResponseEntity<?> obtenerVentasRapidas(
            @RequestParam(required = false) String codCliente,
            @RequestParam(required = false) Integer anio,
            @RequestParam(required = false) Integer mes,
            @RequestParam(required = false) String marca,
            @RequestParam(required = false) Integer limit,
            @RequestParam(required = false) Integer offset
    ) {
        String cod = resolveCodCliente(codCliente);
        List<Map<String, Object>> res = fybecaService.obtenerVentasResumen(cod, anio, mes, marca, limit, offset);
        return ResponseEntity.ok(res);
    }

    @GetMapping("/venta/{id}")
    public ResponseEntity<Venta> obtenerVentaPorId(@PathVariable Long id,
                                                   @RequestParam(required = false) String codCliente) {
        String cod = resolveCodCliente(codCliente);

        Optional<Venta> opt = ventaRepository.findById(id);
        if (opt.isEmpty()) return ResponseEntity.notFound().build();

        Venta v = opt.get();
        if (v.getCliente() == null || v.getCliente().getCodCliente() == null) {
            return ResponseEntity.status(HttpStatus.CONFLICT).build();
        }

        if (!cod.equalsIgnoreCase(v.getCliente().getCodCliente().trim())) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }

        return ResponseEntity.ok(v);
    }

    @DeleteMapping("/venta/{id}")
    public ResponseEntity<Void> eliminarVenta(@PathVariable Long id,
                                              @RequestParam(required = false) String codCliente) {
        String cod = resolveCodCliente(codCliente);

        try {
            Optional<Venta> opt = ventaRepository.findById(id);
            if (opt.isEmpty()) return ResponseEntity.notFound().build();

            Venta v = opt.get();
            if (v.getCliente() == null || v.getCliente().getCodCliente() == null) {
                return ResponseEntity.status(HttpStatus.CONFLICT).build();
            }

            if (!cod.equalsIgnoreCase(v.getCliente().getCodCliente().trim())) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            }

            ventaRepository.delete(v);
            return ResponseEntity.noContent().build();
        } catch (Exception e) {
            logger.error("Error eliminando venta id={}: {}", id, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    // >>> Borrado masivo en lotes <<<
    @DeleteMapping("/ventas-forma-masiva")
    public ResponseEntity<Void> eliminarVentas(@RequestBody List<Long> ids,
                                               @RequestParam(required = false) String codCliente) {
        String cod = resolveCodCliente(codCliente);

        if (ids == null || ids.isEmpty()) return ResponseEntity.ok().build();

        int fallidos = 0;

        for (List<Long> batch : partition(ids, DELETE_BATCH_SIZE)) {
            try {
                List<Venta> ventas = ventaRepository.findAllById(batch);

                // borrar SOLO las del cliente solicitado
                List<Venta> aBorrar = new ArrayList<>();
                for (Venta v : ventas) {
                    if (v.getCliente() != null
                            && v.getCliente().getCodCliente() != null
                            && cod.equalsIgnoreCase(v.getCliente().getCodCliente().trim())) {
                        aBorrar.add(v);
                    }
                }

                if (!aBorrar.isEmpty()) {
                    ventaRepository.deleteAllInBatch(aBorrar);
                }
            } catch (Exception e) {
                logger.error("Error eliminando lote de ventas (tam={}): {}", batch.size(), e.getMessage(), e);
                fallidos++;
            }
        }

        return (fallidos == 0)
                ? ResponseEntity.ok().build()
                : ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
    }

    /**
     * Subida de ventas usando el FybecaVentaService (INSERT ONLY).
     */
    @PostMapping("/subir-archivo-venta")
    public ResponseEntity<Map<String, Object>> subirArchivoVenta(@RequestParam("file") MultipartFile file,
                                                                 @RequestParam(required = false) String codCliente) {
        String cod = resolveCodCliente(codCliente);

        if (file == null || file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "ok", false,
                    "message", "El archivo está vacío."
            ));
        }

        try {
            var clienteOpt = clienteService.findByCodCliente(cod);
            if (clienteOpt.isEmpty()) {
                return ResponseEntity.badRequest().body(Map.of(
                        "ok", false,
                        "message", "Cliente no existe: " + cod
                ));
            }

            try (InputStream is = file.getInputStream()) {
                Map<String, Object> resultado = fybecaService.cargarExcelFybeca(is, cod, file.getOriginalFilename());

                @SuppressWarnings("unchecked")
                List<String> cods = (List<String>) resultado.getOrDefault("codigosNoEncontrados", List.of());

                resultado.put("tieneNoEncontrados", cods != null && !cods.isEmpty());
                return ResponseEntity.ok(resultado);
            }
        } catch (Exception e) {
            logger.error("Error subiendo archivo Fybeca: {}", e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                    "ok", false,
                    "message", e.getMessage()
            ));
        }
    }

    /**
     * Descargar TXT de no encontrados.
     */
    @PostMapping("/codigos-no-encontrados/txt")
    public ResponseEntity<Resource> descargarCodigosNoEncontradosTxt(@RequestBody List<String> codigosNoEncontrados) {
        return fybecaService.obtenerArchivoCodigosNoEncontrados(codigosNoEncontrados);
    }

    // ---------- Catálogos auxiliares ----------
    @GetMapping("/marcas-ventas")
    public List<String> obtenerMarcasDisponibles(@RequestParam(required = false) String codCliente) {
        String cod = resolveCodCliente(codCliente);
        return fybecaService.obtenerMarcasDisponibles(cod);
    }

    @GetMapping("/anios-disponibles")
    public ResponseEntity<List<Integer>> obtenerAniosDisponibles(@RequestParam(required = false) String codCliente) {
        String cod = resolveCodCliente(codCliente);
        return ResponseEntity.ok(fybecaService.obtenerAniosDisponibles(cod));
    }

    @GetMapping("/meses-disponibles")
    public ResponseEntity<List<Integer>> obtenerMesesDisponibles(@RequestParam(required = false) Integer anio,
                                                                 @RequestParam(required = false) String codCliente) {
        String cod = resolveCodCliente(codCliente);
        return ResponseEntity.ok(fybecaService.obtenerMesesDisponibles(cod, anio));
    }

    // ---------- CRUD Clientes ----------
    @GetMapping("/cliente")
    public List<Cliente> tablaClientes() {
        return clienteService.getAllClientes();
    }

    @GetMapping("/cliente/{id}")
    public ResponseEntity<Cliente> obtenerCliente(@PathVariable Long id) {
        return clienteService.getClienteById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }

    @PostMapping("/cliente")
    public Cliente crearCliente(@RequestBody Cliente cliente) {
        return clienteService.saveOrUpdate(cliente);
    }

    @PutMapping("/cliente/{id}")
    public ResponseEntity<Cliente> actualizarCliente(@PathVariable Long id, @RequestBody Cliente cliente) {
        if (clienteService.getClienteById(id).isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        cliente.setId(id);
        return ResponseEntity.ok(clienteService.saveOrUpdate(cliente));
    }

    @DeleteMapping("/cliente/{id}")
    public ResponseEntity<Void> eliminarCliente(@PathVariable Long id) {
        if (clienteService.getClienteById(id).isEmpty()) {
            return ResponseEntity.notFound().build();
        }
        clienteService.deleteCliente(id);
        return ResponseEntity.noContent().build();
    }

    // ---------- CRUD Productos ----------
    @GetMapping("/productos")
    public List<Producto> tablaProductos() {
        return productoService.getAllProductos();
    }

    @PostMapping("/producto")
    public Producto crearProducto(@RequestBody Producto producto) {
        return productoService.saveOrUpdate(producto);
    }

    @PostMapping("/template-productos")
    public ResponseEntity<String> cargarProductosDesdeArchivo(@RequestParam("file") MultipartFile file) {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body("Por favor, seleccione un archivo");
        }
        try {
            String mensaje = productoService.cargarProductosDesdeArchivo(file);
            HttpStatus status = mensaje.toLowerCase().startsWith("error") ? HttpStatus.BAD_REQUEST : HttpStatus.OK;
            return new ResponseEntity<>(mensaje, status);
        } catch (Exception e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("Error inesperado: " + e.getMessage());
        }
    }

    @DeleteMapping("/productos")
    public ResponseEntity<ProductoService.DeleteProductosResult> eliminarProductos(@RequestBody List<Long> ids) {
        var result = productoService.deleteProductosSafe(ids);
        return ResponseEntity.ok(result);
    }

    // ---------- CRUD Tipo Mueble ----------
    @PostMapping("/tipo-mueble")
    public ResponseEntity<TipoMueble> crearTipoMueble(@RequestBody TipoMueble tipoMueble) {
        TipoMueble nuevoTipoMueble = tipoMuebleService.guardarTipoMueble(tipoMueble);
        return ResponseEntity.ok(nuevoTipoMueble);
    }

    @GetMapping("/tipo-mueble")
    public ResponseEntity<List<TipoMueble>> obtenerTodosLosTiposMueble() {
        List<TipoMueble> tiposMueble = tipoMuebleService.obtenerTodosLosTiposMuebleFybeca();
        return ResponseEntity.ok(tiposMueble);
    }

    @GetMapping("/tipo-mueble/{id}")
    public ResponseEntity<TipoMueble> obtenerTipoMueblePorId(@PathVariable Long id) {
        Optional<TipoMueble> tipoMueble = tipoMuebleService.obtenerTipoMueblePorId(id);
        return tipoMueble.map(ResponseEntity::ok).orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping("/tipo-mueble/{id}")
    public ResponseEntity<TipoMueble> actualizarTipoMueble(@PathVariable Long id, @RequestBody TipoMueble nuevoTipoMueble) {
        try {
            TipoMueble tipoMuebleActualizado = tipoMuebleService.actualizarTipoMueble(id, nuevoTipoMueble);
            return ResponseEntity.ok(tipoMuebleActualizado);
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @DeleteMapping("/tipo-mueble/{id}")
    public ResponseEntity<Void> eliminarTipoMueble(@PathVariable Long id) {
        if (tipoMuebleService.eliminarTipoMueble(id)) {
            return ResponseEntity.ok().build();
        } else {
            return ResponseEntity.notFound().build();
        }
    }

    @PostMapping("/template-tipo-muebles")
    public ResponseEntity<List<TipoMueble>> subirTipoMuebles(@RequestParam("file") MultipartFile file) {
        List<TipoMueble> tipoMuebles = tipoMuebleService.cargarTipoMueblesDesdeArchivoFybeca(file);
        return ResponseEntity.ok(tipoMuebles);
    }

    @DeleteMapping("/eliminar-varios-tipo-mueble")
    public ResponseEntity<String> eliminarTiposMueble(@RequestBody List<Long> ids) {
        boolean todosEliminados = tipoMuebleService.eliminarTiposMueble(ids);
        if (todosEliminados) {
            return ResponseEntity.ok("Tipos de muebles eliminados correctamente.");
        } else {
            return ResponseEntity.status(404).body("Algunos tipos de muebles no se encontraron.");
        }
    }

    // ---------- Reportes ----------
    @GetMapping("/reporte-ventas")
    public ResponseEntity<byte[]> generarReporteVentas(@RequestParam(required = false) String codCliente) {
        try {
            String cod = resolveCodCliente(codCliente);
            byte[] byteArray = fybecaReportService.generarReporteVentasXlsx(cod);

            return ResponseEntity.ok()
                    .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                    .header("Content-Disposition", "attachment; filename=reporte_ventas.xlsx")
                    .body(byteArray);

        } catch (Exception e) {
            logger.error("Error generando reporte ventas: {}", e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/reporte-ventas-zip")
    public ResponseEntity<StreamingResponseBody> generarReporteVentasZip(
            @RequestParam(value = "codCliente", required = false) String codCliente,
            @RequestParam(value = "anio", required = false) Integer anio,
            @RequestParam(value = "mes", required = false) Integer mes,
            @RequestParam(value = "marca", required = false) String marca
    ) {
        String cod = resolveCodCliente(codCliente);
        String filename = "fybeca_ventas_" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")) + ".zip";

        StreamingResponseBody body = outputStream ->
                fybecaService.escribirReporteVentasZip(outputStream, cod, anio, mes, marca);

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + filename)
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(body);
    }

    @GetMapping("/reporte-productos")
    public ResponseEntity<byte[]> generarReporteProductos() {
        try {
            byte[] byteArray = fybecaReportService.generarReporteProductosXlsx();

            return ResponseEntity.ok()
                    .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                    .header("Content-Disposition", "attachment; filename=reporte_productos.xlsx")
                    .body(byteArray);

        } catch (Exception e) {
            logger.error("Error generando reporte productos: {}", e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/reporte-tipo-mueble")
    public ResponseEntity<byte[]> generarReporteTipoMueble() {
        try {
            byte[] byteArray = fybecaReportService.generarReporteTipoMuebleXlsx();

            return ResponseEntity.ok()
                    .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                    .header("Content-Disposition", "attachment; filename=reporte_tipo_mueble.xlsx")
                    .body(byteArray);

        } catch (Exception e) {
            logger.error("Error generando reporte tipo mueble: {}", e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
