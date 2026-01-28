package com.manamer.backend.business.sellout.service;

import com.manamer.backend.business.sellout.models.Cliente;
import com.manamer.backend.business.sellout.models.Producto;
import com.manamer.backend.business.sellout.models.Venta;

import org.apache.poi.hssf.usermodel.HSSFWorkbook;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.logging.Logger;

@Service
public class DepratiVentaService {

    public static final String COD_CLIENTE_DEPRATI = "MZCL-000009";
    private static final Logger logger = Logger.getLogger(DepratiVentaService.class.getName());
    private static final int DELETE_BATCH_SIZE = 5000;

    // ✅ MISMA REGLA: placeholder para evitar mezclar tiendas vacías/null
    private static final String PDV_PLACEHOLDER = "SIN_TIENDA";

    private final VentaService ventaService;
    private final ClienteService clienteService; // <- NUEVO

    @Autowired
    public DepratiVentaService(VentaService ventaService,
                              ClienteService clienteService) { // <- NUEVO
        this.ventaService = ventaService;
        this.clienteService = clienteService; // <- NUEVO
    }

    /**
     * Normaliza codPdv:
     * - null/vacío => "SIN_TIENDA"
     * - si viene con espacios => trim
     */
    private static String normalizarCodPdv(String codPdv) {
        if (codPdv == null) return PDV_PLACEHOLDER;
        String t = codPdv.trim();
        return t.isEmpty() ? PDV_PLACEHOLDER : t;
    }

    /**
     * Busca por codCliente y devuelve la entidad con id cargado.
     * Si no existe, aquí lanzo excepción para asegurar integridad.
     */
    private Cliente resolveClienteOrThrow(String codCliente) {
        return clienteService.findByCodCliente(codCliente)
                .orElseThrow(() -> new IllegalStateException(
                        "No existe Cliente con codCliente=" + codCliente));
    }

    /**
     * Asegura que la venta tenga un Cliente con id (no solo el código).
     * Si la venta ya trae Cliente con id, respeta ese id.
     */
    private void ensureClienteAttached(Venta v, String codCliente) {
        if (v == null) return;
        if (v.getCliente() != null && v.getCliente().getId() != null) return;
        Cliente cli = resolveClienteOrThrow(codCliente);
        v.setCliente(cli); // ahora v.getCliente().getId() NO es null
    }

    // ----------------------------- Helpers comunes -----------------------------

    public static String normalizarTexto(String input) {
        if (input == null) return null;
        return Normalizer.normalize(input.toLowerCase().trim(), Normalizer.Form.NFD)
                .replaceAll("\\p{InCombiningDiacriticalMarks}+", "")
                .replaceAll("[^\\p{ASCII}]", "")
                .replaceAll("[\\.,\\\"\\']", "");
    }

    private Workbook obtenerWorkbookCorrecto(MultipartFile file) throws IOException {
        String nombreArchivo = file.getOriginalFilename();
        if (nombreArchivo != null && nombreArchivo.toLowerCase().endsWith(".xls")) {
            return new HSSFWorkbook(file.getInputStream());
        } else if (nombreArchivo != null && nombreArchivo.toLowerCase().endsWith(".xlsx")) {
            return new XSSFWorkbook(file.getInputStream());
        } else {
            throw new IllegalArgumentException("Formato de archivo no soportado: " + nombreArchivo);
        }
    }

    private <T> T obtenerValorCelda(Cell cell, Class<T> clazz) {
        if (cell == null) return null;
        try {
            switch (cell.getCellType()) {
                case NUMERIC:
                    if (clazz == Integer.class) return clazz.cast((int) cell.getNumericCellValue());
                    if (clazz == Double.class)  return clazz.cast(cell.getNumericCellValue());
                    if (clazz == String.class)  return clazz.cast(String.valueOf((int) cell.getNumericCellValue()));
                    break;
                case STRING:
                    String v = cell.getStringCellValue().trim();
                    if (clazz == Integer.class) {
                        try { return clazz.cast(Integer.parseInt(v)); }
                        catch (NumberFormatException ignore) { return null; }
                    }
                    if (clazz == Double.class) {
                        try { return clazz.cast(Double.parseDouble(v)); }
                        catch (NumberFormatException ignore) { return null; }
                    }
                    return clazz.cast(v);
                case BLANK:
                    return null;
                default:
                    return null;
            }
        } catch (Exception e) {
            logger.warning("Error al convertir celda: " + cell + " | " + e.getMessage());
        }
        return null;
    }

    private String obtenerTextoCrudoCelda(Cell cell) {
        try {
            switch (cell.getCellType()) {
                case STRING:  return cell.getStringCellValue();
                case NUMERIC: return String.valueOf(cell.getNumericCellValue());
                case BOOLEAN: return String.valueOf(cell.getBooleanCellValue());
                case FORMULA: return cell.getCellFormula();
                default:      return "";
            }
        } catch (Exception e) {
            return "¿Valor ilegible?";
        }
    }

    private Double convertirADoubleSeguro(Cell cell, int fila, int columna) {
        try {
            if (cell == null) return 0.0;
            switch (cell.getCellType()) {
                case NUMERIC:  return cell.getNumericCellValue();
                case STRING: {
                    String valor = cell.getStringCellValue().trim()
                            .replace(",", ".")
                            .replaceAll("[^\\d.\\-]", "");
                    if (valor.isEmpty() || valor.equals("-") || valor.equals(".")) return 0.0;
                    return Double.parseDouble(valor);
                }
                case FORMULA:
                    try {
                        return cell.getNumericCellValue();
                    } catch (IllegalStateException e) {
                        String s = cell.getStringCellValue().trim()
                                .replace(",", ".").replaceAll("[^\\d.\\-]", "");
                        return Double.parseDouble(s);
                    }
                default: return 0.0;
            }
        } catch (NumberFormatException e) {
            logger.warning("❌ Formato numérico en fila " + fila + ", col " + columna + " val='"
                    + obtenerTextoCrudoCelda(cell) + "': " + e.getMessage());
            return 0.0;
        } catch (Exception e) {
            logger.warning("⚠️ Error al convertir celda (fila " + fila + ", col " + columna + "): "
                    + e.getMessage() + " | raw='" + obtenerTextoCrudoCelda(cell) + "'");
            return 0.0;
        }
    }

    private static <T> List<List<T>> partition(List<T> list, int size) {
        List<List<T>> parts = new ArrayList<>();
        if (list == null || list.isEmpty() || size <= 0) return parts;
        for (int i = 0; i < list.size(); i += size) {
            parts.add(list.subList(i, Math.min(i + size, list.size())));
        }
        return parts;
    }

    // ----------------------------- Ventas: CRUD filtrado por Deprati -----------------------------

    public List<Venta> obtenerTodasLasVentasDeprati() {
        return ventaService.obtenerTodasLasVentas().stream()
                .filter(v -> v != null
                        && v.getCliente() != null
                        && v.getCliente().getCodCliente() != null
                        && COD_CLIENTE_DEPRATI.equalsIgnoreCase(v.getCliente().getCodCliente()))
                .toList();
    }

    public Optional<Venta> obtenerVentaDepratiPorId(Long id) {
        Optional<Venta> v = ventaService.obtenerVentaPorId(id);
        if (v.isPresent()) {
            var c = v.get().getCliente();
            if (c == null || c.getCodCliente() == null || !COD_CLIENTE_DEPRATI.equals(c.getCodCliente())) {
                return Optional.empty();
            }
        }
        return v;
    }

    public Venta actualizarVentaDeprati(Long id, Venta nuevaVenta) {
        ensureClienteAttached(nuevaVenta, COD_CLIENTE_DEPRATI);
        return ventaService.actualizarVenta(id, nuevaVenta);
    }

    public boolean eliminarVentaDeprati(Long id) {
        Optional<Venta> venta = ventaService.obtenerVentaPorId(id);
        if (venta.isEmpty()) return false;
        Cliente c = venta.get().getCliente();
        if (c == null || c.getCodCliente() == null || !COD_CLIENTE_DEPRATI.equals(c.getCodCliente())) {
            return false;
        }
        return ventaService.eliminarVenta(id);
    }

    public boolean eliminarVentasDeprati(List<Long> ids) {
        if (ids == null || ids.isEmpty()) return true;
        List<Long> idsFiltrados = new ArrayList<>();
        for (Long id : ids) {
            Optional<Venta> v = ventaService.obtenerVentaPorId(id);
            if (v.isPresent()) {
                Cliente c = v.get().getCliente();
                if (c != null && COD_CLIENTE_DEPRATI.equals(c.getCodCliente())) {
                    idsFiltrados.add(id);
                }
            }
        }
        int fallidos = 0;
        for (List<Long> batch : partition(idsFiltrados, DELETE_BATCH_SIZE)) {
            try {
                boolean ok = ventaService.eliminarVentas(batch);
                if (!ok) fallidos++;
            } catch (Exception e) {
                logger.severe("Error eliminando lote de " + batch.size() + " ventas: " + e.getMessage());
                fallidos++;
            }
        }
        return fallidos == 0;
    }

    // ----------------------------- Cargas Excel específicas Deprati -----------------------------

    /**
     * Replica la lógica de /subir-archivos-motor-maping del controller.
     * Devuelve el mismo mapa de respuesta para que el controller solo delegue.
     */
    public ResponseEntity<Map<String, Object>> procesarArchivoExcelFlexible(MultipartFile file) {
        Map<String, Object> respuesta = new HashMap<>();
        logger.info("DepratiFlexible: inicio procesamiento archivo=" + file.getOriginalFilename() + " bytes=" + file.getSize());
        if (file.isEmpty()) {
            respuesta.put("mensaje", "❌ El archivo está vacío.");
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(respuesta);
        }

        int filasLeidas = 0;
        int filasProcesadas = 0;
        Set<String> codigosNoEncontrados = new HashSet<>();

        try (Workbook workbook = obtenerWorkbookCorrecto(file)) {
            Sheet sheet = workbook.getSheetAt(0);
            List<Venta> ventas = new ArrayList<>();

            Map<Integer, String> codPdvMap = new LinkedHashMap<>();
            Map<Integer, String> pdvMap = new LinkedHashMap<>();

            Row rowCodPdv = sheet.getRow(25);
            Row rowPdv = sheet.getRow(26);
            if (rowCodPdv == null || rowPdv == null) {
                respuesta.put("mensaje", "❌ El archivo no tiene las filas necesarias (cod_Pdv/pdv).");
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(respuesta);
            }

            for (int col = 12; col <= 44; col += 2) {
                String codPdvRaw = obtenerValorCelda(rowCodPdv.getCell(col), String.class);
                String pdv = obtenerValorCelda(rowPdv.getCell(col), String.class);

                // ✅ APLICAR REGLA: placeholder para tienda vacía/null
                String codPdv = normalizarCodPdv(codPdvRaw);

                if (pdv != null && !codPdvMap.containsValue(codPdv)) {
                    codPdvMap.put(col, codPdv);
                    pdvMap.put(col, pdv);
                }
            }
            logger.info("DepratiFlexible: PDV detectados=" + codPdvMap.size());

            Row encabezado = sheet.getRow(27);
            if (encabezado == null) {
                respuesta.put("mensaje", "❌ No se encontró fila de encabezados (fila 28 esperada).");
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(respuesta);
            }

            Map<String, List<String>> camposEsperados = new HashMap<>();
            camposEsperados.put("marca", List.of(normalizarTexto("Marca"), normalizarTexto("brand"), normalizarTexto("Marcas")));
            camposEsperados.put("nombreProducto", List.of(normalizarTexto("nombre producto"), normalizarTexto("producto"), normalizarTexto("Descripcion"), normalizarTexto("descripciones")));
            camposEsperados.put("codBarra", List.of(normalizarTexto("codigo de barras"), normalizarTexto("cod_barra"), normalizarTexto("No. Mat. Proveedor")));
            camposEsperados.put("fecha", List.of(normalizarTexto("Día natural"), normalizarTexto("fecha"), normalizarTexto("fecha venta"), normalizarTexto("date")));

            Map<String, Integer> columnaPorCampo = new HashMap<>();
            for (Cell celda : encabezado) {
                String valor = obtenerValorCelda(celda, String.class);
                if (valor == null) continue;
                String valorNormalizado = normalizarTexto(valor);
                for (Map.Entry<String, List<String>> entry : camposEsperados.entrySet()) {
                    if (entry.getValue().contains(valorNormalizado)) {
                        columnaPorCampo.put(entry.getKey(), celda.getColumnIndex());
                    }
                }
            }
            logger.info("DepratiFlexible: columnas mapeadas=" + columnaPorCampo);

            for (String campo : camposEsperados.keySet()) {
                if (!columnaPorCampo.containsKey(campo)) {
                    respuesta.put("mensaje", "❌ No se encontró la columna para: " + campo);
                    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(respuesta);
                }
            }

            for (int i = 29; i <= sheet.getLastRowNum(); i++) {
                Row row = sheet.getRow(i);
                if (row == null) continue;
                filasLeidas++;

                LocalDate fecha = null;
                try {
                    Cell celdaFecha = row.getCell(columnaPorCampo.get("fecha"));
                    String fechaTexto = obtenerValorCelda(celdaFecha, String.class);
                    if (fechaTexto != null && !fechaTexto.isBlank()) {
                        String[] formatos = { "dd.MM.yyyy", "dd/MM/yyyy", "dd-MM-yyyy", "yyyy-MM-dd", "yyyy/MM/dd", "d-MMM-yyyy" };
                        for (String f : formatos) {
                            try {
                                DateTimeFormatter formatter = DateTimeFormatter.ofPattern(f).withLocale(Locale.US);
                                fecha = LocalDate.parse(fechaTexto, formatter);
                                break;
                            } catch (Exception ignored) {}
                        }
                    }
                    if (fecha == null && celdaFecha != null && celdaFecha.getCellType() == CellType.NUMERIC) {
                        if (DateUtil.isCellDateFormatted(celdaFecha)) {
                            Date fechaExcel = celdaFecha.getDateCellValue();
                            fecha = fechaExcel.toInstant().atZone(ZoneId.systemDefault()).toLocalDate();
                        }
                    }
                    if (fecha == null) continue;
                } catch (Exception e) {
                    continue;
                }

                String marca          = obtenerValorCelda(row.getCell(columnaPorCampo.get("marca")), String.class);
                String nombreProducto = obtenerValorCelda(row.getCell(columnaPorCampo.get("nombreProducto")), String.class);
                String codBarra       = obtenerValorCelda(row.getCell(columnaPorCampo.get("codBarra")), String.class);
                String descripcion    = nombreProducto;

                if (codBarra == null || codBarra.isBlank() || codBarra.trim().equalsIgnoreCase("Resultado")) continue;

                for (Map.Entry<Integer, String> entry : codPdvMap.entrySet()) {
                    int col = entry.getKey();

                    // ✅ APLICAR REGLA: placeholder para tienda vacía/null
                    String codPdv = normalizarCodPdv(entry.getValue());

                    String pdv = pdvMap.get(col);
                    Double ventaUnidades = convertirADoubleSeguro(row.getCell(col), i + 1, col);
                    Double ventaUSD      = convertirADoubleSeguro(row.getCell(col + 1), i + 1, col + 1);

                    if (ventaUnidades != null || ventaUSD != null) {
                        Venta venta = new Venta();
                        venta.setAnio(fecha.getYear());
                        venta.setMes(fecha.getMonthValue());
                        venta.setDia(fecha.getDayOfMonth());
                        venta.setMarca(marca);
                        venta.setNombreProducto(nombreProducto);
                        venta.setCodBarra(codBarra);
                        venta.setDescripcion(descripcion);
                        venta.setCodPdv(codPdv);
                        venta.setPdv(pdv);
                        venta.setVentaUnidad(ventaUnidades != null ? ventaUnidades : 0);
                        venta.setVentaDolares(ventaUSD != null ? ventaUSD : 0);
                        venta.setStockDolares(0);
                        venta.setStockUnidades(0);
                        venta.setUnidadesDiarias("0");

                        ensureClienteAttached(venta, COD_CLIENTE_DEPRATI);

                        Producto producto = new Producto();
                        producto.setCodBarraSap(codBarra);
                        venta.setProducto(producto);

                        boolean datosCargados = ventaService.cargarDatosDeProductoDeprati(venta, codigosNoEncontrados);
                        if (!datosCargados) continue;

                        ventas.add(venta);
                        filasProcesadas++;
                        if (ventas.size() >= 1000) {
                            logger.info("DepratiFlexible: guardando lote ventas size=" + ventas.size());
                            ventaService.guardarVentas(ventas);
                            ventas.clear();
                        }
                    }
                }
            }

            if (ventas.isEmpty()) {
                respuesta.put("mensaje", "⚠️ Se leyó el archivo, pero no se encontraron ventas válidas.");
                respuesta.put("codigosNoEncontrados", codigosNoEncontrados);
                return ResponseEntity.status(HttpStatus.NO_CONTENT).body(respuesta);
            }

            logger.info("DepratiFlexible: guardando remanente ventas size=" + ventas.size());
            ventaService.guardarVentas(ventas);
            for (Venta v : ventas) {
                ensureClienteAttached(v, COD_CLIENTE_DEPRATI);
            }
            ventaService.guardarVentas(ventas);

            logger.info("DepratiFlexible: fin procesamiento filasLeidas=" + filasLeidas + " procesadas=" + filasProcesadas + " noEncontrados=" + codigosNoEncontrados.size());
            respuesta.put("mensaje", "✅ Se procesaron " + filasProcesadas + " registros de " + filasLeidas + " filas leídas.");
            respuesta.put("codigosNoEncontrados", codigosNoEncontrados);
            return ResponseEntity.ok(respuesta);

        } catch (IOException e) {
            respuesta.put("mensaje", "❌ Error al procesar el archivo Excel.");
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(respuesta);
        } catch (Exception e) {
            respuesta.put("mensaje", "❌ Error inesperado al procesar.");
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(respuesta);
        }
    }

    /**
     * Replica la lógica de /subir-archivo-venta del controller (búsqueda dinámica de fila “Tienda”).
     */
    public ResponseEntity<Map<String, Object>> procesarArchivoExcelDeprati(MultipartFile file) {
        Map<String, Object> respuesta = new HashMap<>();
        logger.info("Deprati: inicio procesamiento archivo=" + file.getOriginalFilename() + " bytes=" + file.getSize());
        if (file.isEmpty()) {
            respuesta.put("mensaje", "❌ El archivo está vacío.");
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(respuesta);
        }

        int filasLeidas = 0;
        int filasProcesadas = 0;
        Set<String> codigosNoEncontrados = new HashSet<>();

        try (Workbook workbook = obtenerWorkbookCorrecto(file)) {
            Sheet sheet = workbook.getSheetAt(0);
            List<Venta> ventas = new ArrayList<>();

            // localizar fila con “Tienda”
            int filaCodPdv = -1;
            for (int i = 0; i <= sheet.getLastRowNum(); i++) {
                Row row = sheet.getRow(i);
                if (row == null) continue;
                for (Cell cell : row) {
                    String value = obtenerValorCelda(cell, String.class);
                    if (value != null && value.toLowerCase().contains("tienda")) {
                        filaCodPdv = i; break;
                    }
                }
                if (filaCodPdv != -1) break;
            }
            logger.info("Deprati: fila 'Tienda' localizada en=" + filaCodPdv);
            if (filaCodPdv == -1) {
                respuesta.put("mensaje", "❌ No se encontró una fila con celdas que contengan 'Tienda'.");
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(respuesta);
            }

            Row rowCodPdv = sheet.getRow(filaCodPdv);
            Row rowPdv = sheet.getRow(filaCodPdv + 1);
            if (rowPdv == null) {
                respuesta.put("mensaje", "❌ No se encontró la fila siguiente con los nombres de PDV.");
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(respuesta);
            }

            Map<Integer, String> codPdvMap = new LinkedHashMap<>();
            Map<Integer, String> pdvMap = new LinkedHashMap<>();
            for (int col = 0; col < rowCodPdv.getLastCellNum(); col++) {
                String codPdvRaw = obtenerValorCelda(rowCodPdv.getCell(col), String.class);
                if (codPdvRaw == null || !codPdvRaw.toLowerCase().contains("tienda")) continue;

                String pdv = obtenerValorCelda(rowPdv.getCell(col), String.class);

                // ✅ APLICAR REGLA: placeholder para tienda vacía/null
                String codPdv = normalizarCodPdv(codPdvRaw);

                if (pdv != null && !codPdvMap.containsValue(codPdv)) {
                    codPdvMap.put(col, codPdv);
                    pdvMap.put(col, pdv);
                }
            }
            logger.info("Deprati: PDV detectados=" + codPdvMap.size());

            for (int i = 29; i <= sheet.getLastRowNum(); i++) {
                Row row = sheet.getRow(i);
                if (row == null) continue;
                filasLeidas++;

                // fecha en col 11 según tu código original
                LocalDate fecha = null;
                try {
                    Cell celdaFecha = row.getCell(11);
                    String[] formatos = {"dd.MM.yyyy","dd/MM/yyyy","dd-MM-yyyy","yyyy-MM-dd","yyyy/MM/dd","d-MMM-yyyy"};
                    if (celdaFecha != null) {
                        if (celdaFecha.getCellType() == CellType.STRING) {
                            String s = obtenerValorCelda(celdaFecha, String.class);
                            if (s != null && !s.isBlank()) {
                                for (String f : formatos) {
                                    try {
                                        DateTimeFormatter df = DateTimeFormatter.ofPattern(f).withLocale(Locale.US);
                                        fecha = LocalDate.parse(s, df);
                                        break;
                                    } catch (Exception ignored) {}
                                }
                            }
                        } else if (celdaFecha.getCellType() == CellType.NUMERIC && DateUtil.isCellDateFormatted(celdaFecha)) {
                            Date d = celdaFecha.getDateCellValue();
                            fecha = d.toInstant().atZone(ZoneId.systemDefault()).toLocalDate();
                        }
                    }
                    if (fecha == null) continue;
                } catch (Exception ignored) { continue; }

                String marca          = obtenerValorCelda(row.getCell(6), String.class);
                String nombreProducto = obtenerValorCelda(row.getCell(9), String.class);
                String codBarra       = obtenerValorCelda(row.getCell(10), String.class);
                String descripcion    = nombreProducto;

                if (codBarra == null || codBarra.isBlank() || codBarra.trim().equalsIgnoreCase("Resultado")) continue;

                for (Map.Entry<Integer, String> entry : codPdvMap.entrySet()) {
                    int col = entry.getKey();

                    // ✅ APLICAR REGLA: placeholder para tienda vacía/null
                    String codPdv = normalizarCodPdv(entry.getValue());

                    String pdv = pdvMap.get(col);
                    Double ventaUnidades = convertirADoubleSeguro(row.getCell(col), i + 1, col);
                    Double ventaUSD      = convertirADoubleSeguro(row.getCell(col + 1), i + 1, col + 1);

                    if (ventaUnidades != null || ventaUSD != null) {
                        Venta venta = new Venta();
                        venta.setAnio(fecha.getYear());
                        venta.setMes(fecha.getMonthValue());
                        venta.setDia(fecha.getDayOfMonth());
                        venta.setMarca(marca);
                        venta.setNombreProducto(nombreProducto);
                        venta.setCodBarra(codBarra);
                        venta.setDescripcion(descripcion);
                        venta.setCodPdv(codPdv);
                        venta.setPdv(pdv);
                        venta.setVentaUnidad(ventaUnidades != null ? ventaUnidades : 0);
                        venta.setVentaDolares(ventaUSD != null ? ventaUSD : 0);
                        venta.setStockDolares(0);
                        venta.setStockUnidades(0);
                        venta.setUnidadesDiarias("0");

                        Cliente cliente = new Cliente();
                        cliente.setCodCliente(COD_CLIENTE_DEPRATI);
                        venta.setCliente(cliente);

                        Producto producto = new Producto();
                        producto.setCodBarraSap(codBarra);
                        venta.setProducto(producto);

                        boolean datosCargados = ventaService.cargarDatosDeProductoDeprati(venta, codigosNoEncontrados);
                        if (!datosCargados) continue;

                        ventas.add(venta);
                        filasProcesadas++;
                    }
                }
            }

            if (ventas.isEmpty()) {
                respuesta.put("mensaje", "⚠️ Se leyó el archivo, pero no se encontraron ventas válidas.");
                respuesta.put("codigosNoEncontrados", codigosNoEncontrados);
                return ResponseEntity.status(HttpStatus.NO_CONTENT).body(respuesta);
            }

            logger.info("Deprati: guardando remanente ventas size=" + ventas.size());
            ventaService.guardarVentas(ventas);
            for (Venta v : ventas) {
                ensureClienteAttached(v, COD_CLIENTE_DEPRATI);
            }
            ventaService.guardarVentas(ventas);

            logger.info("Deprati: fin procesamiento filasLeidas=" + filasLeidas + " procesadas=" + filasProcesadas + " noEncontrados=" + codigosNoEncontrados.size());
            respuesta.put("mensaje", "✅ Se procesaron " + filasProcesadas + " registros de " + filasLeidas + " filas leídas.");
            respuesta.put("codigosNoEncontrados", codigosNoEncontrados);
            return ResponseEntity.ok(respuesta);

        } catch (IOException e) {
            respuesta.put("mensaje", "❌ Error al procesar el archivo Excel.");
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(respuesta);
        } catch (Exception e) {
            respuesta.put("mensaje", "❌ Error inesperado al procesar.");
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(respuesta);
        }
    }

    // ----------------------------- Carga Excel genérica (parametrizable) -----------------------------

    public ResponseEntity<String> cargarVentasDesdeExcel(MultipartFile archivo, Map<String,Integer> mapeoColumnas, int filaInicio) {
        try {
            boolean ok = ventaService.cargarVentasDesdeExcel(archivo.getInputStream(), mapeoColumnas, filaInicio);
            return ok ? ResponseEntity.ok("Archivo procesado correctamente")
                    : ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error al procesar el archivo");
        } catch (IOException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body("Error al leer el archivo: " + e.getMessage());
        }
    }
}
