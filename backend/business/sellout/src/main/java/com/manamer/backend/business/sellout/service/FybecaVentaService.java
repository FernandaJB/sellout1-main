package com.manamer.backend.business.sellout.service;

import com.manamer.backend.business.sellout.models.Cliente;
import com.manamer.backend.business.sellout.models.Producto;
import com.manamer.backend.business.sellout.models.Venta;
import com.manamer.backend.business.sellout.repositories.VentaRepository;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;

import org.apache.poi.ss.usermodel.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.rowset.SqlRowSet;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.BufferedWriter;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.springframework.http.HttpHeaders;

@Service
public class FybecaVentaService {

    // ====== Config ======
    private static final String DEFAULT_COD_CLIENTE = "MZCL-000014";
    private static final ZoneId ZONE = ZoneId.systemDefault();

    // placeholder para evitar mezclar tiendas vacías/null
    private static final String PDV_PLACEHOLDER = "SIN_TIENDA";

    // ✅ ZIP+CSV: parte el CSV en múltiples archivos dentro del ZIP
    private static final int MAX_FILAS_POR_CSV = 250_000;

    private final VentaRepository ventaRepository;
    private final EntityManager entityManager;
    private final ClienteService clienteService;

    // ✅ NUEVO: para generar reportes grandes sin JPA/leaks
    private final JdbcTemplate jdbcTemplate;

    @Autowired
    public FybecaVentaService(
            VentaRepository ventaRepository,
            EntityManager entityManager,
            ClienteService clienteService,
            JdbcTemplate jdbcTemplate
    ) {
        this.ventaRepository = ventaRepository;
        this.entityManager = entityManager;
        this.clienteService = clienteService;
        this.jdbcTemplate = jdbcTemplate;
    }

    // ====== Helpers Cliente ======
    private Cliente getClienteOrThrow(String codCliente) {
        return clienteService.findByCodCliente(codCliente)
                .orElseThrow(() -> new IllegalStateException("Cliente no existe: " + codCliente));
    }

    // Normaliza codPdv
    private static String normalizarCodPdv(String codPdv) {
        if (codPdv == null) return PDV_PLACEHOLDER;
        String t = codPdv.trim();
        return t.isEmpty() ? PDV_PLACEHOLDER : t;
    }

    // ====== Helpers headers dinámicos ======
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
            for (int c = 0; c < Math.min(row.getLastCellNum(), 150); c++) {
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

    // ====== Lectura de celdas ======
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
                String s = cell.getStringCellValue();
                if (s == null) return null;
                s = s.trim();
                if (s.isBlank()) return null;

                try {
                    LocalDate ld = LocalDate.parse(s);
                    return Date.from(ld.atStartOfDay(ZONE).toInstant());
                } catch (Exception ignore) {}

                try {
                    DateTimeFormatter f = DateTimeFormatter.ofPattern("d/M/uuuu");
                    LocalDate ld = LocalDate.parse(s, f);
                    return Date.from(ld.atStartOfDay(ZONE).toInstant());
                } catch (Exception ignore) {}
            }
        } catch (Exception ignore) {}
        return null;
    }

    // =====================================================================================
    // ==================================== CRUD ==========================================
    // =====================================================================================

    public List<Venta> obtenerTodasLasVentasPorCodCliente(String codCliente) {
        String jpql = "SELECT v FROM Venta v WHERE v.cliente.codCliente = :cod";
        return entityManager.createQuery(jpql, Venta.class)
                .setParameter("cod", codCliente)
                .getResultList();
    }

    public List<Venta> obtenerTodasLasVentasFybeca() {
        return obtenerTodasLasVentasPorCodCliente(DEFAULT_COD_CLIENTE);
    }

    public List<Map<String, Object>> obtenerVentasResumen(
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
        sql.append("SELECT v.id, v.anio, v.mes, v.dia, v.marca, v.nombre_Producto, v.cod_Barra, v.codigo_Sap, v.descripcion, v.cod_Pdv, v.pdv, v.ciudad, v.stock_Dolares, v.stock_Unidades, v.venta_Dolares, v.venta_Unidad, c.cod_Cliente, c.nombre_Cliente ")
                .append("FROM [SELLOUT].[dbo].[venta] v ")
                .append("JOIN [SELLOUT].[dbo].[cliente] c ON c.id = v.cliente_id ")
                .append("WHERE c.cod_Cliente = :cod ");

        if (anio != null) sql.append("AND v.anio = :anio ");
        if (mes != null) sql.append("AND v.mes = :mes ");
        if (marca != null && !marca.isBlank()) sql.append("AND v.marca = :marca ");

        sql.append("ORDER BY v.anio DESC, v.mes DESC, v.id DESC ")
                .append("OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY");

        Query q = entityManager.createNativeQuery(sql.toString());
        q.setParameter("cod", codCliente);
        if (anio != null) q.setParameter("anio", anio);
        if (mes != null) q.setParameter("mes", mes);
        if (marca != null && !marca.isBlank()) q.setParameter("marca", marca);
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

    // =====================================================================================
    // ===================== ✅ REPORTE ZIP + CSV SIN LEAK (STREAMING) ======================
    // =====================================================================================

    /**
     * ✅ IMPORTANTE:
     * - NO usa EntityManager ni @Transactional
     * - Usa JdbcTemplate (SqlRowSet) para no mantener sesión/conn JPA viva
     * - Parte en multiples CSV dentro del ZIP si supera MAX_FILAS_POR_CSV
     */
    public void escribirReporteVentasZip(OutputStream os, String codCliente, Integer anio, Integer mes, String marca) {
        String cod = (codCliente == null || codCliente.isBlank()) ? DEFAULT_COD_CLIENTE : codCliente.trim();
        String marcaNorm = (marca == null || marca.isBlank()) ? null : marca.trim();

        String sql = """
            SELECT
                v.id, v.anio, v.mes, v.dia, v.marca,
                v.nombre_Producto AS nombreProducto,
                v.cod_Barra       AS codBarra,
                v.codigo_Sap      AS codigoSap,
                v.descripcion,
                v.cod_Pdv         AS codPdv,
                v.pdv,
                v.ciudad,
                v.stock_Dolares   AS stockDolares,
                v.stock_Unidades  AS stockUnidades,
                v.venta_Dolares   AS ventaDolares,
                v.venta_Unidad    AS ventaUnidad,
                c.cod_Cliente     AS codCliente,
                c.nombre_Cliente  AS nombreCliente
            FROM [SELLOUT].[dbo].[venta] v
            JOIN [SELLOUT].[dbo].[cliente] c ON c.id = v.cliente_id
            WHERE c.cod_Cliente = ?
              AND (? IS NULL OR v.anio = ?)
              AND (? IS NULL OR v.mes = ?)
              AND (? IS NULL OR LTRIM(RTRIM(v.marca)) = LTRIM(RTRIM(?)))
            ORDER BY v.anio DESC, v.mes DESC, v.dia DESC, v.id DESC
        """;

        try (ZipOutputStream zip = new ZipOutputStream(os)) {
            int parte = 1;
            long filasParte = 0;

            BufferedWriter bw = abrirCsv(zip, parte);
            escribirHeaderCsv(bw);

            SqlRowSet rs = jdbcTemplate.queryForRowSet(
                    sql,
                    cod,
                    anio, anio,
                    mes, mes,
                    marcaNorm, marcaNorm
            );

            while (rs.next()) {
                if (filasParte >= MAX_FILAS_POR_CSV) {
                    bw.flush();
                    zip.closeEntry();

                    parte++;
                    filasParte = 0;

                    bw = abrirCsv(zip, parte);
                    escribirHeaderCsv(bw);
                }

                bw.write(
                        csv(rs.getObject("id")) + "," +
                        csv(rs.getObject("anio")) + "," +
                        csv(rs.getObject("mes")) + "," +
                        csv(rs.getObject("dia")) + "," +
                        csv(rs.getObject("marca")) + "," +
                        csv(rs.getObject("nombreProducto")) + "," +
                        csv(rs.getObject("codBarra")) + "," +
                        csv(rs.getObject("codigoSap")) + "," +
                        csv(rs.getObject("descripcion")) + "," +
                        csv(rs.getObject("codPdv")) + "," +
                        csv(rs.getObject("pdv")) + "," +
                        csv(rs.getObject("ciudad")) + "," +
                        csv(rs.getObject("stockDolares")) + "," +
                        csv(rs.getObject("stockUnidades")) + "," +
                        csv(rs.getObject("ventaDolares")) + "," +
                        csv(rs.getObject("ventaUnidad")) + "," +
                        csv(rs.getObject("codCliente")) + "," +
                        csv(rs.getObject("nombreCliente"))
                );
                bw.newLine();

                filasParte++;
                // flush suave cada N filas (evita usar mucha memoria)
                if ((filasParte % 50_000) == 0) bw.flush();
            }

            bw.flush();
            zip.closeEntry();

            // opcional: README dentro del zip
            zip.putNextEntry(new ZipEntry("README.txt"));
            String readme = "Reporte ZIP+CSV generado: " +
                    LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")) + "\n" +
                    "Cliente: " + cod + "\n" +
                    "Partes: " + parte + "\n";
            zip.write(readme.getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();

        } catch (Exception e) {
            throw new RuntimeException("Error generando ZIP: " + e.getMessage(), e);
        }
    }

    private BufferedWriter abrirCsv(ZipOutputStream zip, int parte) throws IOException {
        String name = String.format("fybeca_ventas_part_%03d.csv", parte);
        zip.putNextEntry(new ZipEntry(name));
        return new BufferedWriter(new java.io.OutputStreamWriter(zip, StandardCharsets.UTF_8), 64 * 1024);
    }

    private void escribirHeaderCsv(BufferedWriter bw) throws IOException {
        bw.write('\ufeff'); // BOM para Excel
        bw.write("id,anio,mes,dia,marca,nombreProducto,codBarra,codigoSap,descripcion,codPdv,pdv,ciudad,stockDolares,stockUnidades,ventaDolares,ventaUnidad,codCliente,nombreCliente");
        bw.newLine();
    }

    private String csv(Object v) {
        if (v == null) return "";
        String s = String.valueOf(v);
        boolean needQuote = s.contains(",") || s.contains("\"") || s.contains("\n") || s.contains("\r");
        if (s.contains("\"")) s = s.replace("\"", "\"\"");
        return needQuote ? "\"" + s + "\"" : s;
    }

    // =====================================================================================
    // ============================= INSERT ONLY (NO UPDATE) ===============================
    // =====================================================================================

    /** ✅ SOLO INSERTA: NO busca existente, NO actualiza */
    @Transactional
    public void guardarVentaSoloInsert(Cliente cliente, Venta nuevaVenta) {
        nuevaVenta.setCliente(cliente); // ID real

        String codBarra = (nuevaVenta.getCodBarra() == null) ? null : nuevaVenta.getCodBarra().trim();
        String codPdv = normalizarCodPdv(nuevaVenta.getCodPdv());

        nuevaVenta.setCodBarra(codBarra);
        nuevaVenta.setCodPdv(codPdv);

        ventaRepository.save(nuevaVenta);
    }

    @Transactional
    public void guardarVentaSoloInsertPorCodCliente(String codCliente, Venta nuevaVenta) {
        Cliente cliente = getClienteOrThrow(codCliente);
        guardarVentaSoloInsert(cliente, nuevaVenta);
    }

    @Transactional
    public void guardarVentaSoloInsertFybeca(Venta nuevaVenta) {
        guardarVentaSoloInsertPorCodCliente(DEFAULT_COD_CLIENTE, nuevaVenta);
    }

    // =====================================================================================
    // =================== Validación ÚNICA: producto por codItem ==========================
    // =====================================================================================

    public boolean cargarProductoPorCodItem(Cliente cliente, Venta venta, Set<String> codigosNoEncontrados) {
        String codigo = venta.getCodBarra(); // aquí viene el codItem desde el Excel
        if (codigo == null || codigo.trim().isEmpty()) {
            if (codigosNoEncontrados != null) codigosNoEncontrados.add("CODITEM_VACIO");
            return false;
        }
        codigo = codigo.trim();

        try {
            String sql = """
                SELECT TOP 1
                    p.id            AS IdProducto,
                    p.cod_Item      AS CodItem,
                    p.cod_Barra_Sap AS CodBarraSap
                FROM SELLOUT.dbo.producto p
                WHERE p.cod_Item = :codigo
            """;
            Query q = entityManager.createNativeQuery(sql);
            q.setParameter("codigo", codigo);

            @SuppressWarnings("unchecked")
            List<Object[]> rows = q.getResultList();
            if (rows.isEmpty()) {
                if (codigosNoEncontrados != null) codigosNoEncontrados.add(codigo);
                return false;
            }

            venta.setCliente(cliente);

            Object[] r = rows.get(0);
            Producto p = new Producto();
            p.setId(((Number) r[0]).longValue());
            p.setCodItem((String) r[1]);
            p.setCodBarraSap((String) r[2]);

            venta.setProducto(p);
            return true;
        } catch (Exception ex) {
            if (codigosNoEncontrados != null) codigosNoEncontrados.add(codigo);
            return false;
        }
    }

    // =====================================================================================
    // =================== Enriquecer desde SAP_Prod_cache (SIN PISAR) =====================
    // =====================================================================================

    private void enriquecerDesdeSapCacheSiFalta(Venta v) {
        String codBarra = v.getCodBarra();
        if (codBarra == null || codBarra.trim().isEmpty()) return;

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
            q.setParameter("cb", codBarra.trim());

            @SuppressWarnings("unchecked")
            List<Object[]> rows = q.getResultList();
            if (rows.isEmpty()) return;

            Object[] r = rows.get(0);
            String codigoSap = (String) r[0];
            String cb = (String) r[1];
            String desc = (String) r[2];
            String marca = (String) r[3];

            if (v.getCodigoSap() == null || v.getCodigoSap().trim().isEmpty()) v.setCodigoSap(codigoSap);
            if ((v.getCodBarra() == null || v.getCodBarra().trim().isEmpty()) && cb != null) v.setCodBarra(cb.trim());
            if (v.getDescripcion() == null || v.getDescripcion().trim().isEmpty()) v.setDescripcion(desc);
            if (v.getNombreProducto() == null || v.getNombreProducto().trim().isEmpty()) v.setNombreProducto(desc);
            if (v.getMarca() == null || v.getMarca().trim().isEmpty()) v.setMarca(marca);

        } catch (Exception ignore) {}
    }

    // =====================================================================================
    // ============================= CARGA EXCEL (FULL) ===================================
    // =====================================================================================

    public Map<String, Object> cargarExcelFybeca(InputStream inputStream, String codCliente, String nombreArchivo) {
        long t0 = System.nanoTime();

        Cliente cliente = getClienteOrThrow(codCliente);
        Set<String> codigosNoEncontrados = new HashSet<>();
        List<Map<String, Object>> incidencias = new ArrayList<>();

        int filasLeidas = 0;
        int filasInsertadas = 0;

        final int BATCH = 2000;

        try (Workbook wb = WorkbookFactory.create(inputStream)) {

            Sheet sh = wb.getNumberOfSheets() > 0 ? wb.getSheetAt(0) : null;
            if (sh == null) {
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("ok", false);
                out.put("archivo", nombreArchivo);
                out.put("codCliente", codCliente);
                out.put("mensaje", "El archivo no tiene hojas.");
                out.put("codigosNoEncontrados", List.of());
                out.put("incidencias", List.of());
                return out;
            }

            Integer headerRow = findHeaderRow(sh, Set.of("cod_item"), 50);
            if (headerRow == null) headerRow = findHeaderRow(sh, Set.of("item"), 50);

            if (headerRow == null) {
                Map<String, Object> out = new LinkedHashMap<>();
                out.put("ok", false);
                out.put("archivo", nombreArchivo);
                out.put("codCliente", codCliente);
                out.put("mensaje", "No se encontró encabezado con COD_ITEM o ITEM.");
                out.put("codigosNoEncontrados", List.of());
                out.put("incidencias", List.of());
                return out;
            }

            Map<String, Integer> h = buildHeaderIndex(sh, headerRow);

            Integer cCodItem = pick(h, "cod_item", "item", "codigo_item", "coditem");

            Integer cFecha   = pick(h, "fecha", "fecha_venta", "fecha_corte");
            Integer cAnio    = pick(h, "anio", "ano");
            Integer cMes     = pick(h, "mes");
            Integer cDia     = pick(h, "dia");

            Integer cCodPdv  = pick(h, "cod_pdv", "codigo_tienda", "cod_tienda", "pdv_codigo", "cod_local", "codigo_pdv");
            Integer cPdv     = pick(h, "pdv", "tienda", "nombre_tienda", "nombre_local");

            Integer cCiudad  = pick(h, "ciudad","CIUDAD");

            Integer cVentaUsd = pick(h, "venta_dolares", "venta_usd", "ventas_usd", "ventas_en_usd","venta dolares");
            Integer cVentaUds = pick(h, "venta_unidad", "venta_unidades", "unidades", "uds", "venta unidades");

            Integer cStockUsd = pick(h, " Stock Dolares", "stock_dolares", "stock_usd", "stock_en_usd");
            Integer cStockUds = pick(h,
        "stock_en_unidades",
        "stock_unidades",
        "stock en Unidad",
        "stock_uds",
        "Stock en Unidades");


            Integer cMarca       = pick(h, "marca");
            Integer cDescripcion = pick(h, "descripcion", "producto", "nombre_producto", "nombreproducto");
            Integer cCodigoSap   = pick(h, "codigo_sap", "cod_sap", "codigo_producto_sap", "codigoprod");

            for (int r = headerRow + 1; r <= sh.getLastRowNum(); r++) {
                Row row = sh.getRow(r);
                if (row == null) continue;

                filasLeidas++;

                try {
                    String codItem = getString(row, cCodItem);
                    if (codItem == null || codItem.isBlank()) {
                        codigosNoEncontrados.add("CODITEM_VACIO");
                        incidencias.add(inc("CODITEM_VACIO", "COD_ITEM vacío. Fila omitida.", r + 1));
                        continue;
                    }
                    codItem = codItem.trim();

                    Venta v = new Venta();
                    v.setCliente(cliente);

                    Integer anio = (cAnio != null) ? safeInt(getString(row, cAnio)) : null;
                    Integer mes  = (cMes != null)  ? safeInt(getString(row, cMes))  : null;
                    Integer dia  = (cDia != null)  ? safeInt(getString(row, cDia))  : null;

                    if (anio != null && mes != null && dia != null) {
                        v.setAnio(anio);
                        v.setMes(mes);
                        v.setDia(dia);
                    } else {
                        Date d = getDate(row, cFecha);
                        var zdt = (d != null)
                                ? d.toInstant().atZone(ZONE)
                                : LocalDate.now().atStartOfDay(ZONE);
                        v.setAnio(zdt.getYear());
                        v.setMes(zdt.getMonthValue());
                        v.setDia(zdt.getDayOfMonth());
                    }

                    // temporal: codItem para validar
                    v.setCodBarra(codItem);

                    String codPdvExcel = getString(row, cCodPdv);
                    String pdvExcel = getString(row, cPdv);

                    String codPdv = normalizarCodPdv(codPdvExcel);
                    v.setCodPdv(codPdv);
                    v.setPdv((pdvExcel != null && !pdvExcel.trim().isEmpty()) ? pdvExcel.trim() : codPdv);

                    v.setCiudad(getString(row, cCiudad));

                    v.setVentaDolares(opt0(getDouble(row, cVentaUsd)));
                    v.setVentaUnidad(opt0(getDouble(row, cVentaUds)));
                    v.setStockDolares(opt0(getDouble(row, cStockUsd)));
                    v.setStockUnidades(opt0(getDouble(row, cStockUds)));

                    String marcaExcel = getString(row, cMarca);
                    String descExcel = getString(row, cDescripcion);
                    String codigoSapExcel = getString(row, cCodigoSap);

                    if (marcaExcel != null && !marcaExcel.trim().isEmpty()) v.setMarca(marcaExcel.trim());
                    if (descExcel != null && !descExcel.trim().isEmpty()) {
                        v.setDescripcion(descExcel.trim());
                        v.setNombreProducto(descExcel.trim());
                    }
                    if (codigoSapExcel != null && !codigoSapExcel.trim().isEmpty()) v.setCodigoSap(codigoSapExcel.trim());

                    boolean okProd = cargarProductoPorCodItem(cliente, v, codigosNoEncontrados);
                    if (!okProd) {
                        incidencias.add(inc(codItem, "No existe PRODUCTO por codItem. Fila omitida.", r + 1));
                        continue;
                    }

                    if (v.getProducto() != null && v.getProducto().getCodBarraSap() != null
                            && !v.getProducto().getCodBarraSap().trim().isEmpty()) {
                        v.setCodBarra(v.getProducto().getCodBarraSap().trim());
                    } else {
                        v.setCodBarra(codItem);
                    }

                    enriquecerDesdeSapCacheSiFalta(v);

                    ventaRepository.save(v);
                    filasInsertadas++;

                    if (filasInsertadas % BATCH == 0) {
                        ventaRepository.flush();
                        entityManager.clear();
                    }

                } catch (Exception exFila) {
                    incidencias.add(inc("ERROR_FILA", "Error fila: " + exFila.getMessage(), r + 1));
                }
            }

            ventaRepository.flush();
            entityManager.clear();

        } catch (Exception e) {
            incidencias.add(inc("ERROR_FATAL", "Error fatal: " + e.getMessage(), -1));
        }

        long t1 = System.nanoTime();
        double segundos = (t1 - t0) / 1_000_000_000.0;

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("archivo", nombreArchivo);
        out.put("codCliente", codCliente);
        out.put("filasLeidas", filasLeidas);
        out.put("filasInsertadas", filasInsertadas);
        out.put("codigosNoEncontrados", codigosNoEncontrados.stream().sorted().collect(Collectors.toList()));
        out.put("incidencias", incidencias);
        out.put("tiempoSegundos", segundos);
        return out;
    }

    public Map<String, Object> cargarExcelFybeca(InputStream inputStream, String nombreArchivo) {
        return cargarExcelFybeca(inputStream, DEFAULT_COD_CLIENTE, nombreArchivo);
    }

    private static Map<String, Object> inc(String codigo, String motivo, int fila) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("codigo", codigo);
        m.put("motivo", motivo);
        m.put("fila", fila);
        return m;
    }

    private static Integer safeInt(String s) {
        if (s == null) return null;
        String x = s.trim();
        if (x.isBlank()) return null;
        try { return Integer.parseInt(x); } catch (Exception e) { return null; }
    }

    private static double opt0(Double d) {
        return d == null ? 0 : d;
    }

    // =====================================================================================
    // ======================== Archivo de no encontrados (TXT) ============================
    // =====================================================================================

    public ResponseEntity<Resource> obtenerArchivoCodigosNoEncontrados(List<String> codigosNoEncontrados) {
        List<String> depurados = (codigosNoEncontrados == null ? List.<String>of() : codigosNoEncontrados).stream()
                .filter(Objects::nonNull)
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .distinct()
                .sorted()
                .collect(Collectors.toList());

        boolean empty = depurados.isEmpty();
        StringBuilder sb = new StringBuilder();
        sb.append("CODIGOS_NO_ENCONTRADOS").append(System.lineSeparator());
        if (empty) {
            sb.append("Sin códigos no encontrados.").append(System.lineSeparator());
        } else {
            depurados.forEach(c -> sb.append(c).append(System.lineSeparator()));
        }

        byte[] bytes = sb.toString().getBytes(StandardCharsets.UTF_8);
        InputStreamResource resource = new InputStreamResource(new ByteArrayInputStream(bytes));
        String filename = "codigos_no_encontrados_" +
                LocalDateTime.now(ZONE).format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")) + ".txt";

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + filename)
                .contentType(MediaType.TEXT_PLAIN)
                .contentLength(bytes.length)
                .body(resource);
    }

    // ====== Catálogos ======

    public List<String> obtenerMarcasDisponibles(String codCliente) {
        String jpql = "SELECT DISTINCT v.marca FROM Venta v WHERE v.marca IS NOT NULL AND v.cliente.codCliente = :cod";
        return entityManager.createQuery(jpql, String.class)
                .setParameter("cod", codCliente)
                .getResultList();
    }

    public List<String> obtenerMarcasDisponiblesFybeca() {
        return obtenerMarcasDisponibles(DEFAULT_COD_CLIENTE);
    }

    public List<Integer> obtenerAniosDisponibles(String codCliente) {
        String jpql = "SELECT DISTINCT v.anio FROM Venta v WHERE v.cliente.codCliente = :cod ORDER BY v.anio DESC";
        return entityManager.createQuery(jpql, Integer.class)
                .setParameter("cod", codCliente)
                .getResultList();
    }

    public List<Integer> obtenerAniosDisponiblesFybeca() {
        return obtenerAniosDisponibles(DEFAULT_COD_CLIENTE);
    }

    public List<Integer> obtenerMesesDisponibles(String codCliente, Integer anio) {
        if (anio == null) {
            String jpql = "SELECT DISTINCT v.mes FROM Venta v WHERE v.cliente.codCliente = :cod ORDER BY v.mes";
            return entityManager.createQuery(jpql, Integer.class)
                    .setParameter("cod", codCliente)
                    .getResultList();
        }
        String jpql = "SELECT DISTINCT v.mes FROM Venta v WHERE v.anio = :anio AND v.cliente.codCliente = :cod ORDER BY v.mes";
        return entityManager.createQuery(jpql, Integer.class)
                .setParameter("anio", anio)
                .setParameter("cod", codCliente)
                .getResultList();
    }

    public List<Integer> obtenerMesesDisponiblesFybeca(Integer anio) {
        return obtenerMesesDisponibles(DEFAULT_COD_CLIENTE, anio);
    }

    // ====== Reporte (opcional) ======

    public List<Object[]> obtenerReporteVentasCrudo(String codCliente) {
        String sql = """
            WITH VentasMensuales AS (
                SELECT v.cod_Pdv, v.pdv,
                       FORMAT(v.anio, '0000') + '-' + FORMAT(v.mes, '00') AS periodo,
                       SUM(CAST(v.venta_Unidad AS INT)) AS total_unidades
                FROM [SELLOUT].[dbo].[venta] v
                JOIN [SELLOUT].[dbo].[cliente] c ON c.id = v.cliente_id
                WHERE c.cod_Cliente = :codCliente
                GROUP BY v.cod_Pdv, v.pdv, v.anio, v.mes
            ),
            PromedioUnidades AS (
                SELECT cod_Pdv, AVG(total_unidades) AS promedio_mensual
                FROM VentasMensuales
                WHERE periodo IN (
                    SELECT DISTINCT TOP 3 periodo FROM VentasMensuales ORDER BY periodo DESC
                )
                GROUP BY cod_Pdv
            )
            SELECT vm.cod_Pdv, vm.pdv, tm.ciudad,
                   tm.tipo_Display_Essence, tm.tipo_Mueble_Display_Catrice,
                   COALESCE(SUM(vm.total_unidades), 0) AS total_unidades_mes,
                   COALESCE(pu.promedio_mensual, 0) AS promedio_mes,
                   ROUND(COALESCE(pu.promedio_mensual, 0) / 30, 2) AS unidad_diaria
            FROM VentasMensuales vm
            INNER JOIN [SELLOUT].[dbo].[tipo_mueble] tm ON vm.cod_Pdv = tm.cod_Pdv
            LEFT JOIN PromedioUnidades pu ON vm.cod_Pdv = pu.cod_Pdv
            GROUP BY vm.cod_Pdv, vm.pdv, tm.ciudad, tm.tipo_Display_Essence, tm.tipo_Mueble_Display_Catrice, pu.promedio_mensual;
        """;
        Query q = entityManager.createNativeQuery(sql);
        q.setParameter("codCliente", codCliente);

        @SuppressWarnings("unchecked")
        List<Object[]> res = q.getResultList();
        return res;
    }

    public List<Object[]> obtenerReporteVentasFybecaCrudo() {
        return obtenerReporteVentasCrudo(DEFAULT_COD_CLIENTE);
    }
}
