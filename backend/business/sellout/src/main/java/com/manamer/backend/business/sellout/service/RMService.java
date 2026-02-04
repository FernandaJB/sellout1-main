package com.manamer.backend.business.sellout.service;

import com.google.common.net.HttpHeaders;
import com.manamer.backend.business.sellout.repositories.VentaRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.apache.poi.ss.usermodel.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.manamer.backend.business.sellout.repositories.ProductoRepository;
import com.manamer.backend.business.sellout.models.*;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class RMService {

    @Autowired
    private ProductoRepository productoRepository;

    private static final String DEFAULT_COD_CLIENTE = "MZCL-003131";
    private static final ZoneId ZONE = ZoneId.systemDefault();

    // ✅ Pon aquí el ID real de tu producto genérico "NO ENCONTRADO"
    private static final Long PRODUCTO_FALLBACK_ID = 3185L; // <-- CAMBIA ESTE ID

    private final VentaRepository ventaRepository;
    private final EntityManager entityManager;
    private final ClienteService clienteService;

    public static final class Incidencia {
        public final String codigo;
        public final String motivo;
        public final int fila;     // fila Excel (1-based)
        public final String hoja;  // VENTAS / STOCK
        public Incidencia(String codigo, String motivo, int fila, String hoja) {
            this.codigo = codigo;
            this.motivo = motivo;
            this.fila = fila;
            this.hoja = hoja;
        }
    }

    public static final class SapCacheRow {
        public final String codigoSap;
        public final String codBarra;
        public final String descripcion;
        public final String marca;

        public SapCacheRow(String codigoSap, String codBarra, String descripcion, String marca) {
            this.codigoSap = codigoSap;
            this.codBarra = codBarra;
            this.descripcion = descripcion;
            this.marca = marca;
        }
    }

    @Autowired
    public RMService(VentaRepository ventaRepository, EntityManager entityManager, ClienteService clienteService) {
        this.ventaRepository = ventaRepository;
        this.entityManager = entityManager;
        this.clienteService = clienteService;
    }

    // ========================= Cliente =========================
    private Cliente getClienteOrThrow(String codCliente) {
        return clienteService.findByCodCliente(codCliente)
                .orElseThrow(() -> new IllegalStateException("Cliente no existe: " + codCliente));
    }

    // ========================= Normalización tienda =========================
    private static String tiendaKey(String tienda) {
        if (tienda == null) return "SIN_TIENDA";
        String t = tienda.trim();
        return t.isEmpty() ? "SIN_TIENDA" : t;
    }

    // ========================= Normalización headers =========================
    private static String norm(String s) {
        if (s == null) return "";
        String x = s.trim().toLowerCase(Locale.ROOT);
        x = Normalizer.normalize(x, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        x = x.replaceAll("[^a-z0-9]+", "_");
        x = x.replaceAll("^_+|_+$", "");
        return x;
    }

    private static Integer findHeaderRow(Sheet sheet, Set<String> requiredHeadersNorm, int maxScanRows) {
        int last = Math.min(sheet.getLastRowNum(), maxScanRows);
        for (int r = 0; r <= last; r++) {
            Row row = sheet.getRow(r);
            if (row == null) continue;

            Set<String> headers = new HashSet<>();
            for (int c = 0; c < Math.min(row.getLastCellNum(), 120); c++) {
                Cell cell = row.getCell(c);
                if (cell == null) continue;
                if (cell.getCellType() == CellType.STRING) {
                    String h = norm(cell.getStringCellValue());
                    if (!h.isBlank()) headers.add(h);
                }
            }
            boolean ok = requiredHeadersNorm.stream().allMatch(headers::contains);
            if (ok) return r;
        }
        return null;
    }

    private static Map<String, Integer> buildHeaderIndex(Sheet sheet, int headerRow) {
        Row row = sheet.getRow(headerRow);
        Map<String, Integer> map = new HashMap<>();
        if (row == null) return map;
        for (int c = 0; c < row.getLastCellNum(); c++) {
            Cell cell = row.getCell(c);
            if (cell == null) continue;
            String raw = (cell.getCellType() == CellType.STRING) ? cell.getStringCellValue() : null;
            String key = norm(raw);
            if (!key.isBlank()) map.put(key, c);
        }
        return map;
    }

    private static Integer pick(Map<String, Integer> header, String... optionsNorm) {
        for (String o : optionsNorm) {
            Integer idx = header.get(o);
            if (idx != null) return idx;
        }
        return null;
    }

    // ========================= Lectura de celdas =========================
    private String getString(Row row, Integer col) {
        if (col == null) return null;
        Cell cell = row.getCell(col);
        if (cell == null) return null;

        return switch (cell.getCellType()) {
            case STRING -> {
                String s = cell.getStringCellValue();
                yield (s == null ? null : s.trim());
            }
            case NUMERIC -> {
                if (DateUtil.isCellDateFormatted(cell)) {
                    LocalDate d = cell.getDateCellValue().toInstant().atZone(ZONE).toLocalDate();
                    yield d.toString();
                }
                yield String.valueOf((long) cell.getNumericCellValue());
            }
            case BOOLEAN -> String.valueOf(cell.getBooleanCellValue());
            case FORMULA -> {
                try { yield cell.getStringCellValue().trim(); }
                catch (Exception ex) { yield cell.getCellFormula(); }
            }
            default -> null;
        };
    }

    private Double getDouble(Row row, Integer col) {
        if (col == null) return null;
        Cell cell = row.getCell(col);
        if (cell == null) return null;

        if (cell.getCellType() == CellType.NUMERIC) return cell.getNumericCellValue();
        if (cell.getCellType() == CellType.STRING) {
            String s = cell.getStringCellValue();
            if (s == null) return null;
            s = s.trim().replace(",", ".");
            if (s.isBlank()) return null;
            try { return Double.parseDouble(s); } catch (Exception ignore) { return null; }
        }
        return null;
    }

    private static final List<DateTimeFormatter> DATE_FORMATS = List.of(
            DateTimeFormatter.ofPattern("dd/MM/uuuu"),
            DateTimeFormatter.ofPattern("d/M/uuuu"),
            DateTimeFormatter.ofPattern("dd-MM-uuuu"),
            DateTimeFormatter.ofPattern("d-M-uuuu"),
            DateTimeFormatter.ISO_LOCAL_DATE,
            DateTimeFormatter.ofPattern("MM/dd/uuuu"),
            DateTimeFormatter.ofPattern("M/d/uuuu")
    );

    private LocalDate tryParseLocalDate(String s) {
        if (s == null) return null;
        String x = s.trim();
        if (x.isBlank()) return null;
        int sp = x.indexOf(' '); if (sp > 0) x = x.substring(0, sp);
        int t  = x.indexOf('T'); if (t > 0) x = x.substring(0, t);

        for (DateTimeFormatter f : DATE_FORMATS) {
            try { return LocalDate.parse(x, f); } catch (Exception ignore) {}
        }
        return null;
    }

    private Date getDate(Row row, Integer col) {
        if (col == null) return null;
        Cell cell = row.getCell(col);
        if (cell == null) return null;

        try {
            if (cell.getCellType() == CellType.NUMERIC && DateUtil.isCellDateFormatted(cell)) {
                return cell.getDateCellValue();
            }
            if (cell.getCellType() == CellType.NUMERIC) {
                return DateUtil.getJavaDate(cell.getNumericCellValue());
            }
            if (cell.getCellType() == CellType.STRING) {
                LocalDate ld = tryParseLocalDate(cell.getStringCellValue());
                if (ld != null) return Date.from(ld.atStartOfDay(ZONE).toInstant());
            }
        } catch (Exception ignore) {}
        return null;
    }

    // ========================= SAP_Prod_cache =========================
    private Optional<SapCacheRow> findSapCacheByCodBarra(String codBarraSap) {
        if (codBarraSap == null) return Optional.empty();
        String cb = codBarraSap.trim();
        if (cb.isEmpty()) return Optional.empty();

        try {
            String sql = """
                SELECT TOP 1
                    codigo_sap,
                    cod_barra,
                    descripcion,
                    marca
                FROM SELLOUT.dbo.SAP_Prod_cache
                WHERE cod_barra = :cb
            """;
            Query q = entityManager.createNativeQuery(sql);
            q.setParameter("cb", cb);

            @SuppressWarnings("unchecked")
            List<Object[]> rows = q.getResultList();
            if (rows.isEmpty()) return Optional.empty();

            Object[] r = rows.get(0);
            return Optional.of(new SapCacheRow(
                    (String) r[0],
                    (String) r[1],
                    (String) r[2],
                    (String) r[3]
            ));
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private void aplicarDatosSapCache(Venta v, SapCacheRow sap) {
        if (sap == null) return;
        v.setCodigoSap(sap.codigoSap);
        if (sap.codBarra != null && !sap.codBarra.isBlank()) v.setCodBarra(sap.codBarra.trim());
        v.setDescripcion(sap.descripcion);
        v.setNombreProducto(sap.descripcion);
        v.setMarca(sap.marca);
    }

    /**
     * Inserta Producto si no existe, usando datos de SAP_Prod_cache.
     * IMPORTANTE: Ajusta los setters según tu entidad Producto.
     */
    @Transactional
    protected Long crearProductoDesdeSapCache(String cb, SapCacheRow sap) {
        // Recheck por si se insertó en paralelo (o en otra iteración)
        Optional<Long> ya = productoRepository.findIdByCodBarraSap(cb);
        if (ya.isPresent()) return ya.get();

        Producto p = new Producto();

        // ⚠️ Ajusta estos setters si tu entidad Producto usa otros nombres.
        // Lo mínimo: guardar codBarraSap para poder encontrarlo después.
        try {
            p.setCodBarraSap(cb);
        } catch (Exception ignore) {
            // si tu entidad no tiene setCodBarraSap, debes ajustar esto
        }

        Producto saved = productoRepository.save(p);
        productoRepository.flush();
        return saved.getId();
    }

    // ======= SAP cache en lote =======
    private Map<String, SapCacheRow> findSapCacheByCodBarraBatch(Set<String> codigos) {
        Map<String, SapCacheRow> out = new HashMap<>();
        if (codigos == null || codigos.isEmpty()) return out;

        List<String> list = codigos.stream()
                .filter(Objects::nonNull)
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .distinct()
                .toList();

        int CHUNK = 900;
        for (int i = 0; i < list.size(); i += CHUNK) {
            List<String> sub = list.subList(i, Math.min(i + CHUNK, list.size()));

            String sql = """
                SELECT codigo_sap, cod_barra, descripcion, marca
                FROM SELLOUT.dbo.SAP_Prod_cache
                WHERE cod_barra IN :cbs
            """;

            Query q = entityManager.createNativeQuery(sql);
            q.setParameter("cbs", sub);

            @SuppressWarnings("unchecked")
            List<Object[]> rows = q.getResultList();
            for (Object[] r : rows) {
                SapCacheRow row = new SapCacheRow(
                        (String) r[0],
                        (String) r[1],
                        (String) r[2],
                        (String) r[3]
                );
                if (row.codBarra != null) out.put(row.codBarra.trim(), row);
            }
        }
        return out;
    }

    // ========================= Resolver PRODUCTO ids en lote (1 query) =========================
    private Map<String, Long> findProductoIdsBatchByCodBarraSap(Collection<String> cods) {
        if (cods == null || cods.isEmpty()) return Map.of();

        List<Object[]> rows = productoRepository.findIdsByCodBarraSapIn(cods);

        Map<String, Long> out = new HashMap<>(rows.size() * 2);
        for (Object[] r : rows) {
            String cod = (String) r[0];
            Long id = (Long) r[1];
            if (cod != null && id != null) {
                out.put(cod.trim(), id);
            }
        }
        return out;
    }

    // ========================= Upsert VENTAS =========================
    @Transactional
    protected void upsertVentasEnBloque(List<Venta> lote) {
        if (lote == null || lote.isEmpty()) return;

        final int BATCH = 2000;

        for (int i = 0; i < lote.size(); i++) {
            Venta v = lote.get(i);

            String codBarra = v.getCodBarra() == null ? null : v.getCodBarra().trim();
            v.setCodBarra(codBarra);

            String codPdv = tiendaKey(v.getCodPdv());
            v.setCodPdv(codPdv);
            v.setPdv(codPdv);

            Long clienteId = v.getCliente() != null ? v.getCliente().getId() : null;

            Optional<Venta> existente = ventaRepository
                    .findByClienteIdAndAnioAndMesAndDiaAndCodBarraAndCodPdv(
                            clienteId, v.getAnio(), v.getMes(), v.getDia(), v.getCodBarra(), v.getCodPdv()
                    );

            if (existente.isPresent()) {
                Venta e = existente.get();
                e.setVentaDolares(v.getVentaDolares());
                e.setVentaUnidad(v.getVentaUnidad());
                e.setMarca(v.getMarca());
                e.setNombreProducto(v.getNombreProducto());
                e.setDescripcion(v.getDescripcion());
                e.setCodigoSap(v.getCodigoSap());
                e.setPdv(v.getPdv());
                e.setCiudad(v.getCiudad());
                e.setProducto(v.getProducto());
                ventaRepository.save(e);
            } else {
                ventaRepository.save(v);
            }

            if ((i + 1) % BATCH == 0) {
                ventaRepository.flush();
                entityManager.clear();
            }
        }

        ventaRepository.flush();
        entityManager.clear();
    }

    // ========================= STOCK =========================
    @Transactional
    protected void upsertStockEnBloque(Long clienteId, List<Venta> loteStock) {
        if (loteStock == null || loteStock.isEmpty()) return;

        final int BATCH = 2000;
        int i = 0;

        for (Venta v : loteStock) {

            String codBarra = v.getCodBarra() == null ? null : v.getCodBarra().trim();
            v.setCodBarra(codBarra);

            String codPdv = tiendaKey(v.getCodPdv());
            v.setCodPdv(codPdv);
            v.setPdv(codPdv);

            String sqlUpd = """
                UPDATE SELLOUT.dbo.venta
                   SET stock_unidades = :su,
                       stock_dolares  = :sd
                 WHERE cliente_id = :cli
                   AND anio = :anio AND mes = :mes AND dia = :dia
                   AND cod_barra = :cb
                   AND cod_pdv   = :cp
            """;

            int updated = entityManager.createNativeQuery(sqlUpd)
                    .setParameter("su", v.getStockUnidades())
                    .setParameter("sd", v.getStockDolares())
                    .setParameter("cli", clienteId)
                    .setParameter("anio", v.getAnio())
                    .setParameter("mes", v.getMes())
                    .setParameter("dia", v.getDia())
                    .setParameter("cb", v.getCodBarra())
                    .setParameter("cp", v.getCodPdv())
                    .executeUpdate();

            if (updated == 0) {
                ventaRepository.save(v);
            }

            i++;
            if (i % BATCH == 0) {
                ventaRepository.flush();
                entityManager.clear();
            }
        }

        ventaRepository.flush();
        entityManager.clear();
    }

    // ========================= Carga Excel RM (VENTAS + STOCK) =========================
    public Map<String, Object> cargarExcelRM(InputStream inputStream, String codCliente, String nombreArchivo) {
        long t0 = System.nanoTime();

        Cliente cliente = getClienteOrThrow(codCliente);
        List<Incidencia> incidencias = new ArrayList<>();
        Set<String> codigosNoEncontrados = new HashSet<>();

        int filasLeidasVentas = 0, filasProcesadasVentas = 0;
        int filasLeidasStock  = 0, filasProcesadasStock  = 0;

        final int BUFFER_SIZE = 5000;

        try (Workbook wb = WorkbookFactory.create(inputStream)) {

            // ============================================================
            // PRE-SCAN: recolectar TODOS los códigos (sin filtros de positivos)
            // ============================================================
            Set<String> codigosParaBuscar = new HashSet<>();

            Sheet shVentas = wb.getSheet("VENTAS");
            if (shVentas == null) shVentas = wb.getSheetAt(0);

            Integer headerVentas = findHeaderRow(shVentas, Set.of("fecha_venta", "nombre_tienda", "ref_proveedor"), 30);
            Map<String, Integer> hV = (headerVentas == null) ? Map.of() : buildHeaderIndex(shVentas, headerVentas);

            Integer cFechaV  = (headerVentas == null) ? null : pick(hV, "fecha_venta");
            Integer cTiendaV = (headerVentas == null) ? null : pick(hV, "nombre_tienda", "tienda");
            Integer cRefV    = (headerVentas == null) ? null : pick(hV, "ref_proveedor");
            Integer cUsdV    = (headerVentas == null) ? null : pick(hV, "ventas_en_usd_sin_iva");
            Integer cUdsV    = (headerVentas == null) ? null : pick(hV, "ventas_en_udd");

            if (headerVentas != null) {
                for (int r = headerVentas + 1; r <= shVentas.getLastRowNum(); r++) {
                    Row row = shVentas.getRow(r);
                    if (row == null) continue;
                    String cb = getString(row, cRefV);
                    if (cb != null && !cb.isBlank()) codigosParaBuscar.add(cb.trim());
                }
            }

            Sheet shStock = wb.getSheet("STOCK");
            Integer headerStock = null;
            Map<String, Integer> hS = Map.of();
            Integer cFechaS = null, cTiendaS = null, cRefS = null, cUnS = null, cDolS = null;

            if (shStock != null) {
                headerStock = findHeaderRow(shStock, Set.of("fecha_corte", "tienda", "ref_proveedor"), 30);
                if (headerStock != null) {
                    hS = buildHeaderIndex(shStock, headerStock);
                    cFechaS  = pick(hS, "fecha_corte");
                    cTiendaS = pick(hS, "tienda", "nombre_tienda");
                    cRefS    = pick(hS, "ref_proveedor");
                    cUnS     = pick(hS, "cantidad_unidades");
                    cDolS    = pick(hS, "cantidad_dolares");

                    for (int r = headerStock + 1; r <= shStock.getLastRowNum(); r++) {
                        Row row = shStock.getRow(r);
                        if (row == null) continue;
                        String cb = getString(row, cRefS);
                        if (cb != null && !cb.isBlank()) codigosParaBuscar.add(cb.trim());
                    }
                }
            }

            // ============================================================
            // precargar SAP cache y productos
            // ============================================================
            Map<String, SapCacheRow> sapMap = findSapCacheByCodBarraBatch(codigosParaBuscar);
            Map<String, Long> productoIdMap = new HashMap<>(findProductoIdsBatchByCodBarraSap(codigosParaBuscar));

            // ============================================================
            // VENTAS
            // ============================================================
            if (headerVentas == null) {
                incidencias.add(new Incidencia("GENERAL",
                        "No se encontró encabezado de VENTAS (requiere fecha_venta, Nombre_Tienda, REF_Proveedor).",
                        -1, "VENTAS"));
            } else {
                List<Venta> buffer = new ArrayList<>(BUFFER_SIZE);

                for (int r = headerVentas + 1; r <= shVentas.getLastRowNum(); r++) {
                    Row row = shVentas.getRow(r);
                    if (row == null) continue;

                    filasLeidasVentas++;

                    try {
                        Date fecha = getDate(row, cFechaV);
                        var zdt = (fecha != null)
                                ? fecha.toInstant().atZone(ZONE)
                                : LocalDate.now().atStartOfDay(ZONE);

                        String tienda = tiendaKey(getString(row, cTiendaV));
                        String codBarraSap = getString(row, cRefV);

                        if (codBarraSap == null || codBarraSap.isBlank()) {
                            // Si no hay codbarra, no podemos enlazar producto/llave -> se registra y se omite
                            codigosNoEncontrados.add("CODBARRA_VACIO");
                            incidencias.add(new Incidencia("CODBARRA_VACIO", "REF_Proveedor vacío. Fila omitida.", r + 1, "VENTAS"));
                            continue;
                        }

                        String cb = codBarraSap.trim();

                        Long productoId = productoIdMap.get(cb);

                        // Si no existe en PRODUCTO -> buscar en SAP_Prod_cache y CREAR producto
                        if (productoId == null) {
                            codigosNoEncontrados.add(cb); // registrar como no encontrado inicialmente

                            SapCacheRow sap = sapMap.get(cb);
                            if (sap != null) {
                                // crear producto desde SAP
                                productoId = crearProductoDesdeSapCache(cb, sap);
                                productoIdMap.put(cb, productoId);

                                incidencias.add(new Incidencia(cb,
                                        "No existía en PRODUCTO. Se creó desde SAP_Prod_cache con id=" + productoId,
                                        r + 1, "VENTAS"));
                            } else {
                                // ni en SAP -> fallback
                                productoId = PRODUCTO_FALLBACK_ID;
                                incidencias.add(new Incidencia(cb,
                                        "No existe en PRODUCTO ni en SAP_Prod_cache. Se carga con PRODUCTO_FALLBACK_ID=" + PRODUCTO_FALLBACK_ID,
                                        r + 1, "VENTAS"));
                            }
                        }

                        Double ventaUsd = getDouble(row, cUsdV);
                        Double ventaUds = getDouble(row, cUdsV);

                        Venta v = new Venta();
                        v.setCliente(cliente);

                        v.setAnio(zdt.getYear());
                        v.setMes(zdt.getMonthValue());
                        v.setDia(zdt.getDayOfMonth());

                        v.setCodBarra(cb);
                        v.setCodPdv(tienda);
                        v.setPdv(tienda);

                        v.setVentaDolares(ventaUsd != null ? ventaUsd : 0);
                        v.setVentaUnidad(ventaUds != null ? ventaUds : 0);

                        // si existe en SAP, llena datos en Venta (sin bloquear)
                        SapCacheRow sapVenta = sapMap.get(cb);
                        if (sapVenta != null) aplicarDatosSapCache(v, sapVenta);

                        v.setStockDolares(0);
                        v.setStockUnidades(0);
                        v.setUnidadesDiarias("0");

                        Producto p = new Producto();
                        p.setId(productoId);
                        v.setProducto(p);

                        buffer.add(v);
                        filasProcesadasVentas++;

                        if (buffer.size() >= BUFFER_SIZE) {
                            upsertVentasEnBloque(buffer);
                            buffer.clear();
                        }

                    } catch (Exception exFila) {
                        incidencias.add(new Incidencia("ERROR_FILA",
                                "Error procesando fila: " + exFila.getMessage(),
                                r + 1, "VENTAS"));
                    }
                }

                if (!buffer.isEmpty()) upsertVentasEnBloque(buffer);
            }

            // ============================================================
            // STOCK
            // ============================================================
            if (shStock != null) {
                if (headerStock == null) {
                    incidencias.add(new Incidencia("GENERAL",
                            "No se encontró encabezado de STOCK (requiere fecha_corte, Tienda, REF_Proveedor).",
                            -1, "STOCK"));
                } else {
                    List<Venta> bufferStock = new ArrayList<>(BUFFER_SIZE);

                    for (int r = headerStock + 1; r <= shStock.getLastRowNum(); r++) {
                        Row row = shStock.getRow(r);
                        if (row == null) continue;

                        filasLeidasStock++;

                        try {
                            Date fecha = getDate(row, cFechaS);
                            var zdt = (fecha != null)
                                    ? fecha.toInstant().atZone(ZONE)
                                    : LocalDate.now().atStartOfDay(ZONE);

                            String tienda = tiendaKey(getString(row, cTiendaS));
                            String codBarraSap = getString(row, cRefS);

                            if (codBarraSap == null || codBarraSap.isBlank()) {
                                codigosNoEncontrados.add("CODBARRA_VACIO");
                                incidencias.add(new Incidencia("CODBARRA_VACIO", "REF_Proveedor vacío. Fila omitida.", r + 1, "STOCK"));
                                continue;
                            }

                            String cb = codBarraSap.trim();

                            Long productoId = productoIdMap.get(cb);

                            if (productoId == null) {
                                codigosNoEncontrados.add(cb);

                                SapCacheRow sap = sapMap.get(cb);
                                if (sap != null) {
                                    productoId = crearProductoDesdeSapCache(cb, sap);
                                    productoIdMap.put(cb, productoId);

                                    incidencias.add(new Incidencia(cb,
                                            "No existía en PRODUCTO. Se creó desde SAP_Prod_cache con id=" + productoId,
                                            r + 1, "STOCK"));
                                } else {
                                    productoId = PRODUCTO_FALLBACK_ID;
                                    incidencias.add(new Incidencia(cb,
                                            "No existe en PRODUCTO ni en SAP_Prod_cache. Se carga con PRODUCTO_FALLBACK_ID=" + PRODUCTO_FALLBACK_ID,
                                            r + 1, "STOCK"));
                                }
                            }

                            Double su = getDouble(row, cUnS);
                            Double sd = getDouble(row, cDolS);

                            Venta v = new Venta();
                            v.setCliente(cliente);

                            v.setAnio(zdt.getYear());
                            v.setMes(zdt.getMonthValue());
                            v.setDia(zdt.getDayOfMonth());

                            v.setCodBarra(cb);
                            v.setCodPdv(tienda);
                            v.setPdv(tienda);

                            v.setVentaDolares(0);
                            v.setVentaUnidad(0);

                            v.setStockUnidades(su != null ? su : 0);
                            v.setStockDolares(sd != null ? sd : 0);

                            SapCacheRow sapStock = sapMap.get(cb);
                            if (sapStock != null) aplicarDatosSapCache(v, sapStock);

                            v.setUnidadesDiarias("0");

                            Producto p = new Producto();
                            p.setId(productoId);
                            v.setProducto(p);

                            bufferStock.add(v);
                            filasProcesadasStock++;

                            if (bufferStock.size() >= BUFFER_SIZE) {
                                upsertStockEnBloque(cliente.getId(), bufferStock);
                                bufferStock.clear();
                            }

                        } catch (Exception exFila) {
                            incidencias.add(new Incidencia("ERROR_FILA",
                                    "Error procesando fila: " + exFila.getMessage(),
                                    r + 1, "STOCK"));
                        }
                    }

                    if (!bufferStock.isEmpty()) upsertStockEnBloque(cliente.getId(), bufferStock);
                }
            }

        } catch (Exception e) {
            incidencias.add(new Incidencia("GENERAL", "ERROR FATAL: " + e.getMessage(), -1, "GENERAL"));
        }

        long t1 = System.nanoTime();
        double segundos = (t1 - t0) / 1_000_000_000.0;

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", incidencias.stream().noneMatch(i -> "GENERAL".equals(i.codigo)));
        out.put("archivo", nombreArchivo);
        out.put("codCliente", codCliente);

        out.put("filasLeidasVentas", filasLeidasVentas);
        out.put("filasProcesadasVentas", filasProcesadasVentas);

        out.put("filasLeidasStock", filasLeidasStock);
        out.put("filasProcesadasStock", filasProcesadasStock);

        out.put("codigosNoEncontrados", codigosNoEncontrados.stream().sorted().collect(Collectors.toList()));
        out.put("incidencias", incidencias);
        out.put("tiempoSegundos", segundos);
        return out;
    }

    public Map<String, Object> cargarExcelRM(InputStream inputStream, String nombreArchivo) {
        return cargarExcelRM(inputStream, DEFAULT_COD_CLIENTE, nombreArchivo);
    }

    // ========================= TXT incidencias =========================
    public ResponseEntity<Resource> generarIncidenciasTxt(String nombreArchivoOrigen,
                                                         Map<String, Object> resultado) {

        @SuppressWarnings("unchecked")
        List<Incidencia> incidencias = (List<Incidencia>) resultado.getOrDefault("incidencias", List.of());
        @SuppressWarnings("unchecked")
        List<String> cods = (List<String>) resultado.getOrDefault("codigosNoEncontrados", List.of());

        String ts = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));

        StringBuilder sb = new StringBuilder();
        sb.append("INCIDENCIAS DE CARGA RM").append('\n')
          .append("Archivo: ").append(Objects.toString(nombreArchivoOrigen, "")).append('\n')
          .append("Fecha/Hora: ").append(ts).append('\n')
          .append("Ventas - Filas leídas: ").append(resultado.getOrDefault("filasLeidasVentas", 0)).append('\n')
          .append("Ventas - Filas procesadas: ").append(resultado.getOrDefault("filasProcesadasVentas", 0)).append('\n')
          .append("Stock  - Filas leídas: ").append(resultado.getOrDefault("filasLeidasStock", 0)).append('\n')
          .append("Stock  - Filas procesadas: ").append(resultado.getOrDefault("filasProcesadasStock", 0)).append('\n')
          .append("Tiempo (s): ").append(resultado.getOrDefault("tiempoSegundos", 0)).append("\n\n");

        sb.append("CODIGOS_NO_ENCONTRADOS").append('\n');
        if (cods == null || cods.isEmpty()) sb.append("Sin códigos no encontrados.\n");
        else cods.forEach(c -> sb.append(c).append('\n'));

        sb.append("\nDETALLE_INCIDENCIAS").append('\n');
        sb.append("HOJA\tFILA\tCODIGO\tMOTIVO\n");
        if (incidencias == null || incidencias.isEmpty()) {
            sb.append("Sin incidencias.\n");
        } else {
            for (Incidencia i : incidencias) {
                sb.append(Objects.toString(i.hoja, ""))
                  .append('\t')
                  .append(i.fila)
                  .append('\t')
                  .append(Objects.toString(i.codigo, ""))
                  .append('\t')
                  .append(Objects.toString(i.motivo, ""))
                  .append('\n');
            }
        }

        byte[] bytes = sb.toString().getBytes(StandardCharsets.UTF_8);
        InputStreamResource resource = new InputStreamResource(new ByteArrayInputStream(bytes));

        String filename = "incidencias_RM_" +
                LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")) + ".txt";

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + filename)
                .contentType(MediaType.TEXT_PLAIN)
                .contentLength(bytes.length)
                .body(resource);
    }
 
    // =====================================================================================
    // ===================================== CRUD RM =======================================
    // =====================================================================================

    public List<Map<String, Object>> obtenerVentasResumen(
            Integer anio,
            Integer mes,
            String marca,
            Integer limit,
            Integer offset
    ) {
        return obtenerVentasResumenPorCodCliente(DEFAULT_COD_CLIENTE, anio, mes, marca, limit, offset);
    }

    public List<Map<String, Object>> obtenerVentasResumenPorCodCliente(
            String codCliente,
            Integer anio,
            Integer mes,
            String marca,
            Integer limit,
            Integer offset
    ) {
        if (limit == null || limit <= 0) limit = 1000;
        if (offset == null || offset < 0) offset = 0;

        StringBuilder sql = new StringBuilder();
        sql.append("SELECT v.id, v.anio, v.mes, v.dia, v.marca, v.nombre_Producto, v.cod_Barra, v.codigo_Sap, v.descripcion, ")
           .append("v.cod_Pdv, v.pdv, v.ciudad, v.stock_Dolares, v.stock_Unidades, v.venta_Dolares, v.venta_Unidad, ")
           .append("c.cod_Cliente, c.nombre_Cliente ")
           .append("FROM [SELLOUT].[dbo].[venta] v ")
           .append("JOIN [SELLOUT].[dbo].[cliente] c ON c.id = v.cliente_id ")
           .append("WHERE c.cod_Cliente = :cod ");

        if (anio != null) sql.append("AND v.anio = :anio ");
        if (mes != null) sql.append("AND v.mes = :mes ");
        if (marca != null && !marca.isBlank()) sql.append("AND v.marca = :marca ");

        sql.append("ORDER BY v.anio DESC, v.mes DESC, v.dia DESC, v.id DESC ")
           .append("OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY");

        Query q = entityManager.createNativeQuery(sql.toString());
        q.setParameter("cod", codCliente);
        if (anio != null) q.setParameter("anio", anio);
        if (mes != null) q.setParameter("mes", mes);
        if (marca != null && !marca.isBlank()) q.setParameter("marca", marca.trim());
        q.setParameter("offset", offset);
        q.setParameter("limit", limit);

        @SuppressWarnings("unchecked")
        List<Object[]> rows = q.getResultList();
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Object[] r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r[0]);
            m.put("anio", r[1]);
            m.put("mes", r[2]);
            m.put("dia", r[3]);
            m.put("marca", r[4]);
            m.put("nombreProducto", r[5]);
            m.put("codBarra", r[6]);
            m.put("codigoSap", r[7]);
            m.put("descripcion", r[8]);
            m.put("codPdv", r[9]);
            m.put("pdv", r[10]);
            m.put("ciudad", r[11]);
            m.put("stockDolares", r[12]);
            m.put("stockUnidades", r[13]);
            m.put("ventaDolares", r[14]);
            m.put("ventaUnidad", r[15]);
            m.put("codCliente", r[16]);
            m.put("nombreCliente", r[17]);
            out.add(m);
        }
        return out;
    }

    public List<Map<String, Object>> obtenerVentasTodasPorCodCliente(
            String codCliente,
            Integer anio,
            Integer mes,
            String marca
    ) {
        StringBuilder sql = new StringBuilder();
        sql.append("SELECT v.id, v.anio, v.mes, v.dia, v.marca, v.nombre_Producto, v.cod_Barra, v.codigo_Sap, v.descripcion, ")
           .append("v.cod_Pdv, v.pdv, v.ciudad, v.stock_Dolares, v.stock_Unidades, v.venta_Dolares, v.venta_Unidad, ")
           .append("c.cod_Cliente, c.nombre_Cliente ")
           .append("FROM [SELLOUT].[dbo].[venta] v ")
           .append("JOIN [SELLOUT].[dbo].[cliente] c ON c.id = v.cliente_id ")
           .append("WHERE c.cod_Cliente = :cod ");

        if (anio != null) sql.append("AND v.anio = :anio ");
        if (mes != null) sql.append("AND v.mes = :mes ");
        if (marca != null && !marca.isBlank()) sql.append("AND v.marca = :marca ");

        sql.append("ORDER BY v.anio DESC, v.mes DESC, v.dia DESC, v.id DESC");

        Query q = entityManager.createNativeQuery(sql.toString());
        q.setParameter("cod", codCliente);
        if (anio != null) q.setParameter("anio", anio);
        if (mes != null) q.setParameter("mes", mes);
        if (marca != null && !marca.isBlank()) q.setParameter("marca", marca.trim());

        @SuppressWarnings("unchecked")
        List<Object[]> rows = q.getResultList();
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (Object[] r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r[0]);
            m.put("anio", r[1]);
            m.put("mes", r[2]);
            m.put("dia", r[3]);
            m.put("marca", r[4]);
            m.put("nombreProducto", r[5]);
            m.put("codBarra", r[6]);
            m.put("codigoSap", r[7]);
            m.put("descripcion", r[8]);
            m.put("codPdv", r[9]);
            m.put("pdv", r[10]);
            m.put("ciudad", r[11]);
            m.put("stockDolares", r[12]);
            m.put("stockUnidades", r[13]);
            m.put("ventaDolares", r[14]);
            m.put("ventaUnidad", r[15]);
            m.put("codCliente", r[16]);
            m.put("nombreCliente", r[17]);
            out.add(m);
        }
        return out;
    }

    public Optional<Venta> obtenerVentaPorId(Long id) {
        return obtenerVentaPorIdYCodCliente(id, DEFAULT_COD_CLIENTE);
    }

    public Optional<Venta> obtenerVentaPorIdYCodCliente(Long id, String codCliente) {
        String jpql = "SELECT v FROM Venta v WHERE v.id = :id AND v.cliente.codCliente = :cod";
        List<Venta> res = entityManager.createQuery(jpql, Venta.class)
                .setParameter("id", id)
                .setParameter("cod", codCliente)
                .getResultList();
        return res.isEmpty() ? Optional.empty() : Optional.of(res.get(0));
    }

    @Transactional
    public Venta actualizarVenta(Long id, Venta nuevaVenta) {
        return actualizarVentaPorCodCliente(id, DEFAULT_COD_CLIENTE, nuevaVenta);
    }

    @Transactional
    public Venta actualizarVentaPorCodCliente(Long id, String codCliente, Venta nuevaVenta) {
        Cliente cliente = getClienteOrThrow(codCliente);
        nuevaVenta.setCliente(cliente); // asegura cliente_id real

        return ventaRepository.findById(id).map(v -> {
            // seguridad: solo permitir si pertenece al cliente RM
            if (v.getCliente() == null || v.getCliente().getCodCliente() == null ||
                !codCliente.equalsIgnoreCase(v.getCliente().getCodCliente())) {
                throw new RuntimeException("Venta no pertenece al cliente: " + codCliente);
            }

            v.setAnio(nuevaVenta.getAnio());
            v.setMes(nuevaVenta.getMes());
            v.setDia(nuevaVenta.getDia());
            v.setMarca(nuevaVenta.getMarca());
            v.setVentaDolares(nuevaVenta.getVentaDolares());
            v.setVentaUnidad(nuevaVenta.getVentaUnidad());
            v.setNombreProducto(nuevaVenta.getNombreProducto());
            v.setCodigoSap(nuevaVenta.getCodigoSap());
            v.setCodBarra(nuevaVenta.getCodBarra());
            v.setCodPdv(tiendaKey(nuevaVenta.getCodPdv()));
            v.setDescripcion(nuevaVenta.getDescripcion());
            v.setPdv(nuevaVenta.getPdv());
            v.setStockDolares(nuevaVenta.getStockDolares());
            v.setStockUnidades(nuevaVenta.getStockUnidades());
            v.setCiudad(nuevaVenta.getCiudad());
            v.setCliente(cliente);
            v.setProducto(nuevaVenta.getProducto());
            return ventaRepository.save(v);
        }).orElseThrow(() -> new RuntimeException("Venta no encontrada con el ID: " + id));
    }

    @Transactional
    public boolean eliminarVenta(Long id) {
        return eliminarVentaPorCodCliente(id, DEFAULT_COD_CLIENTE);
    }

    @Transactional
    public boolean eliminarVentaPorCodCliente(Long id, String codCliente) {
        Optional<Venta> opt = obtenerVentaPorIdYCodCliente(id, codCliente);
        if (opt.isEmpty()) return false;
        ventaRepository.delete(opt.get());
        return true;
    }

    // ✅ DELETE MASIVO (solo borra ventas del cliente RM)
    @Transactional
    public Map<String, Object> eliminarVentasMasivo(List<Long> ids) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (ids == null || ids.isEmpty()) {
            out.put("ok", true);
            out.put("deletedCount", 0);
            out.put("mensaje", "Lista vacía, no se eliminó nada.");
            return out;
        }

        Cliente cliente = getClienteOrThrow(DEFAULT_COD_CLIENTE);

        // Traer solo las ventas que pertenezcan a RM
        List<Venta> ventas = ventaRepository.findAllById(ids);
        List<Venta> filtradas = ventas.stream()
                .filter(v -> v != null
                        && v.getCliente() != null
                        && v.getCliente().getId() != null
                        && Objects.equals(v.getCliente().getId(), cliente.getId()))
                .collect(Collectors.toList());

        int solicitados = ids.size();
        int aEliminar = filtradas.size();

        try {
            ventaRepository.deleteAll(filtradas);
            ventaRepository.flush();
            out.put("ok", true);
            out.put("solicitados", solicitados);
            out.put("deletedCount", aEliminar);
            out.put("omitidos", solicitados - aEliminar);
            out.put("mensaje", "Eliminación masiva completada (solo cliente RM).");
            return out;
        } catch (Exception e) {
            out.put("ok", false);
            out.put("solicitados", solicitados);
            out.put("deletedCount", 0);
            out.put("mensaje", "Error eliminando ventas en lote: " + e.getMessage());
            return out;
        }
    }

    @Transactional(readOnly = true)
    public void escribirReporteVentasZip(java.io.OutputStream os, String codCliente, Integer anio, Integer mes, String marca) {
        try (java.util.zip.ZipOutputStream zip = new java.util.zip.ZipOutputStream(os);
             java.io.OutputStreamWriter osw = new java.io.OutputStreamWriter(zip, java.nio.charset.StandardCharsets.UTF_8);
             java.io.BufferedWriter bw = new java.io.BufferedWriter(osw)) {
            zip.putNextEntry(new java.util.zip.ZipEntry("rm_ventas.csv"));
            bw.write("\uFEFF");
            bw.write("id,anio,mes,dia,marca,nombreProducto,codBarra,codigoSap,descripcion,codPdv,pdv,ciudad,stockDolares,stockUnidades,ventaDolares,ventaUnidad,codCliente,nombreCliente");
            bw.newLine();
            int pageSize = 10000;
            int offset = 0;
            while (true) {
                StringBuilder sql = new StringBuilder();
                sql.append("SELECT v.id, v.anio, v.mes, v.dia, v.marca, v.nombre_Producto, v.cod_Barra, v.codigo_Sap, v.descripcion, ");
                sql.append("v.cod_Pdv, v.pdv, v.ciudad, v.stock_Dolares, v.stock_Unidades, v.venta_Dolares, v.venta_Unidad, ");
                sql.append("c.cod_Cliente, c.nombre_Cliente ");
                sql.append("FROM [SELLOUT].[dbo].[venta] v ");
                sql.append("JOIN [SELLOUT].[dbo].[cliente] c ON c.id = v.cliente_id ");
                sql.append("WHERE c.cod_Cliente = :cod ");
                if (anio != null) sql.append("AND v.anio = :anio ");
                if (mes != null) sql.append("AND v.mes = :mes ");
                if (marca != null && !marca.isBlank()) sql.append("AND v.marca = :marca ");
                sql.append("ORDER BY v.anio DESC, v.mes DESC, v.dia DESC, v.id DESC ");
                Query q = entityManager.createNativeQuery(sql.toString());
                q.setParameter("cod", codCliente);
                if (anio != null) q.setParameter("anio", anio);
                if (mes != null) q.setParameter("mes", mes);
                if (marca != null && !marca.isBlank()) q.setParameter("marca", marca.trim());
                q.setFirstResult(offset);
                q.setMaxResults(pageSize);
                @SuppressWarnings("unchecked")
                java.util.List<Object[]> rows = q.getResultList();
                if (rows.isEmpty()) break;
                for (Object[] r : rows) {
                    StringBuilder line = new StringBuilder();
                    line.append(toCsv(r[0])).append(',').append(toCsv(r[1])).append(',').append(toCsv(r[2])).append(',').append(toCsv(r[3])).append(',');
                    line.append(toCsv(r[4])).append(',').append(toCsv(r[5])).append(',').append(toCsv(r[6])).append(',').append(toCsv(r[7])).append(',');
                    line.append(toCsv(r[8])).append(',').append(toCsv(r[9])).append(',').append(toCsv(r[10])).append(',').append(toCsv(r[11])).append(',');
                    line.append(toCsv(r[12])).append(',').append(toCsv(r[13])).append(',').append(toCsv(r[14])).append(',').append(toCsv(r[15])).append(',');
                    line.append(toCsv(r[16])).append(',').append(toCsv(r[17]));
                    bw.write(line.toString());
                    bw.newLine();
                }
                bw.flush();
                offset += pageSize;
            }
            bw.flush();
            zip.closeEntry();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private String toCsv(Object v) {
        if (v == null) return "";
        String s = String.valueOf(v);
        boolean needQuote = s.contains(",") || s.contains("\"") || s.contains("\n") || s.contains("\r");
        if (s.contains("\"")) s = s.replace("\"", "\"\"");
        return needQuote ? "\"" + s + "\"" : s;
    }
}
