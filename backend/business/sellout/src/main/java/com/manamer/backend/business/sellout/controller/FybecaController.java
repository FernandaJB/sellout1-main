package com.manamer.backend.business.sellout.controller;

import com.manamer.backend.business.sellout.models.Cliente;
import com.manamer.backend.business.sellout.models.ExcelUtils;
import com.manamer.backend.business.sellout.models.Producto;
import com.manamer.backend.business.sellout.models.TipoMueble;
import com.manamer.backend.business.sellout.models.Venta;
import com.manamer.backend.business.sellout.repositories.ProductoRepository;
import com.manamer.backend.business.sellout.service.ClienteService;
import com.manamer.backend.business.sellout.service.FybecaVentaService;
import com.manamer.backend.business.sellout.service.ProductoService;
import com.manamer.backend.business.sellout.service.TipoMuebleService;

import org.apache.commons.io.output.ByteArrayOutputStream;
import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.text.Normalizer;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@CrossOrigin(origins = "*", allowedHeaders = "*", methods = {RequestMethod.GET, RequestMethod.POST, RequestMethod.PUT, RequestMethod.DELETE})
@RequestMapping("/api-sellout/fybeca")
public class FybecaController {

    /** Default correcto */
    private static final String DEFAULT_COD_CLIENTE = "MZCL-000014";
    private static final int DELETE_BATCH_SIZE = 5000;

    private static final Logger logger = LoggerFactory.getLogger(FybecaController.class);

    private final FybecaVentaService fybecaService;
    private final TipoMuebleService tipoMuebleService;
    private final ClienteService clienteService;
    private final ProductoService productoService;
    private final ProductoRepository repository;

    @Autowired
    public FybecaController(FybecaVentaService fybecaService,
                            TipoMuebleService tipoMuebleService,
                            ClienteService clienteService,
                            ProductoService productoService,
                            ProductoRepository repository) {
        this.fybecaService = fybecaService;
        this.tipoMuebleService = tipoMuebleService;
        this.clienteService = clienteService;
        this.productoService = productoService;
        this.repository = repository;
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

    /** Obtener por id — acepta ?codCliente=... */
    @GetMapping("/venta/{id}")
    public ResponseEntity<Venta> obtenerVentaPorId(@PathVariable Long id,
                                                   @RequestParam(required = false) String codCliente) {
        String cod = resolveCodCliente(codCliente);
        return fybecaService.obtenerVentaPorIdYCodCliente(id, cod)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    /** Actualizar venta — fuerza el cliente con ID real */
    @PutMapping("/venta/{id}")
    public ResponseEntity<Venta> actualizarVenta(@PathVariable Long id,
                                                 @RequestParam(required = false) String codCliente,
                                                 @RequestBody Venta nuevaVenta) {
        try {
            String cod = resolveCodCliente(codCliente);
            var clienteOpt = clienteService.findByCodCliente(cod);
            if (clienteOpt.isEmpty()) return ResponseEntity.status(HttpStatus.BAD_REQUEST).build();
            nuevaVenta.setCliente(clienteOpt.get()); // garantiza cliente_id correcto

            Venta ventaActualizada = fybecaService.actualizarVentaPorCodCliente(id, cod, nuevaVenta);
            return ResponseEntity.ok(ventaActualizada);
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
    }

    @DeleteMapping("/venta/{id}")
    public ResponseEntity<Void> eliminarVenta(@PathVariable Long id) {
        try {
            fybecaService.eliminarVenta(id);
            return ResponseEntity.noContent().build();
        } catch (RuntimeException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
        }
    }

    // >>> Borrado masivo en lotes de 5000 <<<
    @DeleteMapping("/ventas-forma-masiva")
    public ResponseEntity<Void> eliminarVentas(@RequestBody List<Long> ids) {
        if (ids == null || ids.isEmpty()) return ResponseEntity.ok().build();
        int fallidos = 0;
        for (List<Long> batch : partition(ids, DELETE_BATCH_SIZE)) {
            try {
                boolean ok = fybecaService.eliminarVentas(batch);
                if (!ok) fallidos++;
            } catch (Exception e) {
                logger.error("Error eliminando lote de ventas (tam={}): {}", batch.size(), e.getMessage(), e);
                fallidos++;
            }
        }
        return (fallidos == 0) ? ResponseEntity.ok().build()
                               : ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
    }

    /**
     * Subida flexible de ventas:
     * - Detecta columnas por encabezado.
     * - Resuelve Cliente (ID real) y lo asigna a cada venta.
     * - Enriquecimiento con cargarDatosDeProducto(Cliente,...).
     * - Upsert con guardarOActualizarVenta(Cliente,...).
     * - Devuelve TXT con códigos no encontrados.
     */
    @PostMapping("/subir-archivo-venta")
    public ResponseEntity<Map<String, Object>> subirArchivoVentaFlexible(@RequestParam("file") MultipartFile file,
                                                                         @RequestParam(required = false) String codCliente) {
        String cod = resolveCodCliente(codCliente);
        logger.info("Inicio de carga de archivo de ventas: {} para codCliente={}", file.getOriginalFilename(), cod);

        Set<String> codigosNoEncontrados = new HashSet<>();
        List<Map<String, Object>> detalleNoEncontrados = new ArrayList<>();
        if (file.isEmpty()) {
            logger.warn("El archivo recibido está vacío.");
            return ResponseEntity.badRequest().build();
        }

        try (Workbook workbook = obtenerWorkbookCorrecto(file)) {
            var clienteOpt = clienteService.findByCodCliente(cod);
            if (clienteOpt.isEmpty()) {
                logger.error("Cliente con codCliente {} no existe", cod);
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).build();
            }
            final Cliente clienteCarga = clienteOpt.get(); // ID real

            Sheet sheet = workbook.getSheetAt(0);
            Row encabezado = sheet.getRow(0);
            if (encabezado == null) throw new IllegalArgumentException("La primera fila (encabezados) está vacía.");

            Map<String, List<String>> camposEsperados = new HashMap<>();
            camposEsperados.put("anio", List.of("año", "anio", "Año"));
            camposEsperados.put("mes", List.of("mes", "Mes"));
            camposEsperados.put("codBarra", List.of("codigo barra", "cod_barra", "codigobarra", "COD ITEM", "cod barra", "codbarra"));
            camposEsperados.put("codPdv", List.of("codigo pdv", "cod_pdv", "COD LOCAL", "cod pdv"));
            camposEsperados.put("pdv", List.of("pdv", "NOMBRE LOCAL", "nombre pdv"));
            camposEsperados.put("ventaDolares", List.of("venta_dolares", "venta $", "venta dolares", "Venta Dolares", "venta usd"));
            camposEsperados.put("ventaUnidad", List.of("venta_unidades", "venta unidades", "Venta Unidades"));
            camposEsperados.put("stockDolares", List.of("stock_dolares", "stock usd", "Stock Dolares", "stock dolares"));
            camposEsperados.put("stockUnidades", List.of("stock_unidades", "stock unidades", "Stock en Unidades"));
            camposEsperados.put("marca", List.of("marca", "Marca"));
            camposEsperados.put("nombreProducto", List.of("producto", "nombre producto", "Nombre Producto"));
            camposEsperados.put("descripcion", List.of("descripcion", "Descripción"));
            Map<String, Integer> columnaPorCampo = new HashMap<>();
            for (Cell celda : encabezado) {
                String valor = obtenerValorCelda(celda, String.class);
                if (valor == null) continue;
                String valorNormalizado = normalizarTexto(valor);
                for (Map.Entry<String, List<String>> entry : camposEsperados.entrySet()) {
                    boolean match = entry.getValue().stream()
                            .map(FybecaController::normalizarTexto)
                            .anyMatch(v -> v.equals(valorNormalizado));
                    if (match) {
                        columnaPorCampo.put(entry.getKey(), celda.getColumnIndex());
                        logger.info("✔ Columna '{}' mapeada a campo '{}'", valor, entry.getKey());
                    }
                }
            }

            for (String campo : camposEsperados.keySet()) {
                if (!columnaPorCampo.containsKey(campo)) {
                    logger.warn("❌ No se detectó ninguna columna para el campo obligatorio: {}", campo);
                }
            }

            for (int i = 1; i <= sheet.getLastRowNum(); i++) {
                Row row = sheet.getRow(i);
                if (row == null) continue;

                try {
                    Venta venta = new Venta();
                    venta.setDia(1);
                    // Asigna SIEMPRE el cliente con ID real
                    venta.setCliente(clienteCarga);

                    if (columnaPorCampo.containsKey("anio"))
                        venta.setAnio(obtenerValorCelda(row.getCell(columnaPorCampo.get("anio")), Integer.class));
                    if (columnaPorCampo.containsKey("mes"))
                        venta.setMes(obtenerValorCelda(row.getCell(columnaPorCampo.get("mes")), Integer.class));
                    if (columnaPorCampo.containsKey("ventaDolares"))
                        venta.setVentaDolares(obtenerValorCelda(row.getCell(columnaPorCampo.get("ventaDolares")), Double.class));
                    if (columnaPorCampo.containsKey("ventaUnidad"))
                        venta.setVentaUnidad(obtenerValorCelda(row.getCell(columnaPorCampo.get("ventaUnidad")), Double.class));
                    if (columnaPorCampo.containsKey("codBarra"))
                        venta.setCodBarra(obtenerValorCelda(row.getCell(columnaPorCampo.get("codBarra")), String.class));
                    if (columnaPorCampo.containsKey("codPdv"))
                        venta.setCodPdv(obtenerValorCelda(row.getCell(columnaPorCampo.get("codPdv")), String.class));
                    if (columnaPorCampo.containsKey("pdv"))
                        venta.setPdv(obtenerValorCelda(row.getCell(columnaPorCampo.get("pdv")), String.class));
                    if (columnaPorCampo.containsKey("stockDolares"))
                        venta.setStockDolares(obtenerValorCelda(row.getCell(columnaPorCampo.get("stockDolares")), Double.class));
                    if (columnaPorCampo.containsKey("stockUnidades"))
                        venta.setStockUnidades(obtenerValorCelda(row.getCell(columnaPorCampo.get("stockUnidades")), Double.class));
                    if (columnaPorCampo.containsKey("marca"))
                        venta.setMarca(obtenerValorCelda(row.getCell(columnaPorCampo.get("marca")), String.class));
                    if (columnaPorCampo.containsKey("nombreProducto"))
                        venta.setNombreProducto(obtenerValorCelda(row.getCell(columnaPorCampo.get("nombreProducto")), String.class));
                    if (columnaPorCampo.containsKey("descripcion"))
                        venta.setDescripcion(obtenerValorCelda(row.getCell(columnaPorCampo.get("descripcion")), String.class));
                    if (venta.getCodBarra() == null || venta.getCodBarra().trim().isEmpty()) {
                        logger.warn("⚠️ Fila {}: Código de barra vacío", i + 1);
                        detalleNoEncontrados.add(Map.of(
                                "codigo", "CODBARRA_VACIO",
                                "motivo", "Fila " + (i + 1) + ": Código de barra vacío"
                        ));
                        continue;
                    }

                    boolean datosCargados = fybecaService.cargarDatosDeProducto(clienteCarga, venta, codigosNoEncontrados);
                    if (!datosCargados) {
                        logger.warn("⚠️ Fila {}: No se encontraron datos para el código {}", i + 1, venta.getCodBarra());
                        detalleNoEncontrados.add(Map.of(
                                "codigo", Objects.toString(venta.getCodBarra(), "N/D"),
                                "motivo", "Fila " + (i + 1) + ": No se encontraron datos para el código " + Objects.toString(venta.getCodBarra(), "N/D")
                        ));
                        continue;
                    }

                    fybecaService.guardarOActualizarVenta(clienteCarga, venta);

                } catch (Exception exFila) {
                    logger.error("❌ Error procesando fila {}: {}", i + 1, exFila.getMessage(), exFila);
                }
            }

            Map<String, Object> body = new HashMap<>();
            body.put("codigosNoEncontrados", detalleNoEncontrados);
            body.put("filasLeidas", sheet.getLastRowNum());
            body.put("filasProcesadas", sheet.getLastRowNum());
            return ResponseEntity.ok(body);

        } catch (IOException e) {
            logger.error("❌ Error leyendo archivo Excel: {}", e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("message", e.getMessage()));
        } catch (Exception e) {
            logger.error("❌ Error inesperado al procesar archivo: {}", e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("message", e.getMessage()));
        }
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
        if (!clienteService.getClienteById(id).isPresent()) {
            return ResponseEntity.notFound().build();
        }
        cliente.setId(id);
        return ResponseEntity.ok(clienteService.saveOrUpdate(cliente));
    }

    @DeleteMapping("/cliente/{id}")
    public ResponseEntity<Void> eliminarCliente(@PathVariable Long id) {
        if (!clienteService.getClienteById(id).isPresent()) {
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

    // >>> Borrado masivo de productos en lotes de 5000 <<<
    public void deleteProductos(List<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            throw new IllegalArgumentException("No se proporcionaron IDs para eliminar.");
        }
        for (List<Long> batch : partition(ids, DELETE_BATCH_SIZE)) {
            repository.deleteAllById(batch);
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

    // Mantiene método específico para FYBECA (default MZCL-000014)
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
    /** Reporte de ventas: acepta ?codCliente=..., usa default si no se envía */
    @GetMapping("/reporte-ventas")
    public ResponseEntity<byte[]> generarReporteVentas(@RequestParam(required = false) String codCliente) {
        try {
            String cod = resolveCodCliente(codCliente);
            List<Venta> ventas = fybecaService.obtenerTodasLasVentasPorCodCliente(cod);

            XSSFWorkbook workbook = new XSSFWorkbook();
            Sheet sheet = workbook.createSheet("Ventas");

            Row header = sheet.createRow(0);
            header.createCell(0).setCellValue("Año");
            header.createCell(1).setCellValue("Mes");
            header.createCell(2).setCellValue("Marca");
            header.createCell(3).setCellValue("Código Cliente");
            header.createCell(4).setCellValue("Nombre Cliente");
            header.createCell(5).setCellValue("Código Barra SAP");
            header.createCell(6).setCellValue("Código Producto SAP");
            header.createCell(7).setCellValue("Código Item");
            header.createCell(8).setCellValue("Nombre Producto");
            header.createCell(9).setCellValue("Código PDV");
            header.createCell(10).setCellValue("Ciudad");
            header.createCell(11).setCellValue("PDV");
            header.createCell(12).setCellValue("Stock en Dólares");
            header.createCell(13).setCellValue("Stock en Unidades");
            header.createCell(14).setCellValue("Venta en Dólares");
            header.createCell(15).setCellValue("Venta en Unidades");

            int rowNum = 1;
            for (Venta venta : ventas) {
                Row row = sheet.createRow(rowNum++);
                row.createCell(0).setCellValue(venta.getAnio());
                row.createCell(1).setCellValue(venta.getMes());
                row.createCell(2).setCellValue(venta.getMarca());

                if (venta.getCliente() != null) {
                    row.createCell(3).setCellValue(venta.getCliente().getCodCliente());
                    row.createCell(4).setCellValue(venta.getCliente().getNombreCliente());
                    row.createCell(10).setCellValue(venta.getCliente().getCiudad());
                } else {
                    row.createCell(3).setCellValue("N/A");
                    row.createCell(4).setCellValue("N/A");
                    row.createCell(10).setCellValue("N/A");
                }

                row.createCell(5).setCellValue(venta.getCodBarra());
                row.createCell(6).setCellValue(venta.getCodigoSap());

                if (venta.getProducto() != null) {
                    row.createCell(7).setCellValue(venta.getProducto().getCodItem());
                    row.createCell(8).setCellValue(venta.getNombreProducto());
                } else {
                    row.createCell(7).setCellValue("N/A");
                    row.createCell(8).setCellValue("N/A");
                }

                row.createCell(9).setCellValue(venta.getCodPdv());
                row.createCell(11).setCellValue(venta.getPdv());
                row.createCell(12).setCellValue(venta.getStockDolares());
                row.createCell(13).setCellValue(venta.getStockUnidades());
                row.createCell(14).setCellValue(venta.getVentaDolares());
                row.createCell(15).setCellValue(venta.getVentaUnidad());
            }

            byte[] byteArray = ExcelUtils.convertWorkbookToByteArray(workbook);
            workbook.close();

            return ResponseEntity.ok()
                    .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                    .header("Content-Disposition", "attachment; filename=reporte_ventas.xlsx")
                    .body(byteArray);

        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/reporte-productos")
    public ResponseEntity<byte[]> generarReporteProductos() {
        try {
            List<Producto> productos = repository.findAll();

            XSSFWorkbook workbook = new XSSFWorkbook();
            Sheet sheet = workbook.createSheet("Productos");

            Row header = sheet.createRow(0);
            header.createCell(0).setCellValue("Código Item");
            header.createCell(1).setCellValue("Código Barra SAP");

            int rowNum = 1;
            for (Producto producto : productos) {
                Row row = sheet.createRow(rowNum++);
                row.createCell(0).setCellValue(producto.getCodItem());
                row.createCell(1).setCellValue(producto.getCodBarraSap());
            }

            byte[] byteArray = ExcelUtils.convertWorkbookToByteArray(workbook);
            workbook.close();

            return ResponseEntity.ok()
                    .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                    .header("Content-Disposition", "attachment; filename=reporte_productos.xlsx")
                    .body(byteArray);

        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    @GetMapping("/reporte-tipo-mueble")
    public ResponseEntity<byte[]> generarReporteTipoMueble() {
        try {
            List<TipoMueble> tiposMueble = tipoMuebleService.obtenerTodosLosTiposMuebleFybeca();

            XSSFWorkbook workbook = new XSSFWorkbook();
            Sheet sheet = workbook.createSheet("Tipos de Mueble");

            Row header = sheet.createRow(0);
            header.createCell(0).setCellValue("Código Cliente");
            header.createCell(1).setCellValue("Nombre Cliente");
            header.createCell(2).setCellValue("Ciudad");
            header.createCell(3).setCellValue("Código PDV");
            header.createCell(4).setCellValue("Nombre PDV");
            header.createCell(5).setCellValue("Tipo Display Essence");
            header.createCell(6).setCellValue("Tipo Mueble Display Catrice");

            int rowNum = 1;
            for (TipoMueble tipoMueble : tiposMueble) {
                Row row = sheet.createRow(rowNum++);
                if (tipoMueble.getCliente() != null) {
                    row.createCell(0).setCellValue(tipoMueble.getCliente().getCodCliente());
                    row.createCell(1).setCellValue(tipoMueble.getCliente().getNombreCliente());
                    row.createCell(2).setCellValue(tipoMueble.getCiudad());
                } else {
                    row.createCell(0).setCellValue("N/A");
                    row.createCell(1).setCellValue("N/A");
                    row.createCell(2).setCellValue("N/A");
                }
                row.createCell(3).setCellValue(tipoMueble.getCodPdv());
                row.createCell(4).setCellValue(tipoMueble.getNombrePdv());
                row.createCell(5).setCellValue(tipoMueble.getTipoMuebleEssence());
                row.createCell(6).setCellValue(tipoMueble.getTipoMuebleCatrice());
            }

            byte[] byteArray = ExcelUtils.convertWorkbookToByteArray(workbook);
            workbook.close();

            return ResponseEntity.ok()
                    .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                    .header("Content-Disposition", "attachment; filename=reporte_tipo_mueble.xlsx")
                    .body(byteArray);

        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }
}
