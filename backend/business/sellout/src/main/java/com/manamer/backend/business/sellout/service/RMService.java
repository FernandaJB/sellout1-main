package com.manamer.backend.business.sellout.service;

import com.google.common.net.HttpHeaders;
import com.manamer.backend.business.sellout.repositories.VentaRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.util.IOUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import com.manamer.backend.business.sellout.repositories.ProductoRepository;
import com.manamer.backend.business.sellout.models.*;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;

@Service
public class RMService {

    @Autowired
    private ProductoRepository productoRepository;

    static {
        IOUtils.setByteArrayMaxOverride(1024 * 1024 * 1024);
    }

    private static final String DEFAULT_COD_CLIENTE = "MZCL-003131";
    private static final ZoneId ZONE = ZoneId.systemDefault();

    // ✅ Pon aquí el ID real de tu producto genérico "NO ENCONTRADO"
    private static final Long PRODUCTO_FALLBACK_ID = 3185L;

    private final VentaRepository ventaRepository;
    private final EntityManager entityManager;
    private final ClienteService clienteService;
    private final TransactionTemplate txTemplate;
    private final JdbcTemplate jdbcTemplate;

    private enum EstadoCargaAsync {
        PENDIENTE,
        PROCESANDO,
        TERMINADO,
        FALLIDO
    }

    private static final class CargaAsyncJob {
        final String id;
        final String codCliente;
        final String nombreArchivo;
        final long creadoEpochMs;
        volatile long inicioEpochMs;
        volatile long finEpochMs;
        volatile EstadoCargaAsync estado;
        volatile Map<String, Object> resultado;
        volatile String error;

        CargaAsyncJob(String id, String codCliente, String nombreArchivo, long creadoEpochMs) {
            this.id = id;
            this.codCliente = codCliente;
            this.nombreArchivo = nombreArchivo;
            this.creadoEpochMs = creadoEpochMs;
            this.estado = EstadoCargaAsync.PENDIENTE;
        }
    }

    private static final int MAX_JOBS_EN_MEMORIA = 25;
    private final ExecutorService cargaAsyncExecutor = Executors.newSingleThreadExecutor();
    private final ConcurrentHashMap<String, CargaAsyncJob> cargaJobs = new ConcurrentHashMap<>();
    private final ConcurrentLinkedDeque<String> cargaJobsOrden = new ConcurrentLinkedDeque<>();

    // ========================= MODELOS LOG =========================
    public static final class Incidencia {
        public final String codigo;
        public final String motivo;
        public final int fila;     // fila Excel (1-based)
        public final String hoja;  // VENTAS / STOCK / GENERAL
        public Incidencia(String codigo, String motivo, int fila, String hoja) {
            this.codigo = codigo;
            this.motivo = motivo;
            this.fila = fila;
            this.hoja = hoja;
        }

        @Override
        public String toString() {
            return "HOJA=" + hoja + " | FILA=" + fila + " | CODIGO=" + codigo + " | MOTIVO=" + motivo;
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

    // ✅ Para llevar fila Excel al upsert de STOCK SIN tocar tu entidad Venta (lo dejamos por compatibilidad)
    public interface VentaConFilaExcel {
        Integer getFilaExcel();
    }

    public static final class VentaFila extends Venta implements VentaConFilaExcel {
        private Integer filaExcel;
        @Override public Integer getFilaExcel() { return filaExcel; }
        public void setFilaExcel(Integer filaExcel) { this.filaExcel = filaExcel; }
    }

    // ✅ DTO interno para mapear STOCK por llave
    private static final class StockInfo {
        final double su;
        final double sd;
        final int filaExcel;
        final String marca;
        final String nombreMaterial;
        final String codigoMaterial;
        StockInfo(double su, double sd, int filaExcel, String marca, String nombreMaterial, String codigoMaterial) {
            this.su = su;
            this.sd = sd;
            this.filaExcel = filaExcel;
            this.marca = marca;
            this.nombreMaterial = nombreMaterial;
            this.codigoMaterial = codigoMaterial;
        }
    }

    @Autowired
    public RMService(
            VentaRepository ventaRepository,
            EntityManager entityManager,
            ClienteService clienteService,
            PlatformTransactionManager transactionManager,
            JdbcTemplate jdbcTemplate
    ) {
        this.ventaRepository = ventaRepository;
        this.entityManager = entityManager;
        this.clienteService = clienteService;
        this.txTemplate = new TransactionTemplate(transactionManager);
        this.jdbcTemplate = jdbcTemplate;
    }

    public String iniciarCargaExcelRMAsync(byte[] archivoBytes, String codCliente, String nombreArchivo) {
        if (archivoBytes == null || archivoBytes.length == 0) throw new IllegalArgumentException("Archivo vacío.");

        String cod = (codCliente == null || codCliente.isBlank()) ? DEFAULT_COD_CLIENTE : codCliente.trim();
        String nombre = (nombreArchivo == null || nombreArchivo.isBlank()) ? "archivo.xlsx" : nombreArchivo;

        try {
            Path tmp = Files.createTempFile("rm_upload_", ".xlsx");
            Files.write(tmp, archivoBytes);
            return iniciarCargaExcelRMAsync(tmp, cod, nombre);
        } catch (Exception ex) {
            throw new IllegalStateException("No se pudo preparar el archivo temporal: " + (ex.getMessage() != null ? ex.getMessage() : ex.toString()));
        }
    }

    public String iniciarCargaExcelRMAsync(Path archivoTemp, String codCliente, String nombreArchivo) {
        if (archivoTemp == null) throw new IllegalArgumentException("Archivo temporal nulo.");
        if (!Files.exists(archivoTemp)) throw new IllegalArgumentException("Archivo temporal no existe.");

        String cod = (codCliente == null || codCliente.isBlank()) ? DEFAULT_COD_CLIENTE : codCliente.trim();
        String nombre = (nombreArchivo == null || nombreArchivo.isBlank()) ? "archivo.xlsx" : nombreArchivo;

        long now = System.currentTimeMillis();
        String jobId = UUID.randomUUID().toString();
        CargaAsyncJob job = new CargaAsyncJob(jobId, cod, nombre, now);

        cargaJobs.put(jobId, job);
        cargaJobsOrden.addLast(jobId);
        limpiarJobsViejos();

        cargaAsyncExecutor.submit(() -> {
            job.estado = EstadoCargaAsync.PROCESANDO;
            job.inicioEpochMs = System.currentTimeMillis();
            try (InputStream in = Files.newInputStream(archivoTemp)) {
                Map<String, Object> res = cargarExcelRM(in, job.codCliente, job.nombreArchivo);
                job.resultado = res;
                job.estado = EstadoCargaAsync.TERMINADO;
            } catch (Exception ex) {
                job.error = ex.getMessage() != null ? ex.getMessage() : ex.toString();
                job.estado = EstadoCargaAsync.FALLIDO;
            } finally {
                job.finEpochMs = System.currentTimeMillis();
                try { Files.deleteIfExists(archivoTemp); } catch (Exception ignore) {}
            }
        });

        return jobId;
    }

    public Map<String, Object> obtenerEstadoCargaExcelRMAsync(String jobId) {
        if (jobId == null || jobId.isBlank()) {
            return Map.of("ok", false, "error", "jobId requerido");
        }

        CargaAsyncJob job = cargaJobs.get(jobId);
        if (job == null) {
            return Map.of("ok", false, "error", "jobId no encontrado");
        }

        Map<String, Object> resumen = new LinkedHashMap<>();
        if (job.resultado != null) {
            resumen.put("ok", job.resultado.getOrDefault("ok", false));
            resumen.put("filasLeidasVentas", job.resultado.getOrDefault("filasLeidasVentas", 0));
            resumen.put("filasProcesadasVentas", job.resultado.getOrDefault("filasProcesadasVentas", 0));
            resumen.put("filasLeidasStock", job.resultado.getOrDefault("filasLeidasStock", 0));
            resumen.put("filasProcesadasStock", job.resultado.getOrDefault("filasProcesadasStock", 0));
            resumen.put("tiempoSegundos", job.resultado.getOrDefault("tiempoSegundos", 0));
            Object cnf = job.resultado.get("codigosNoEncontrados");
            Object inc = job.resultado.get("incidencias");
            resumen.put("codigosNoEncontradosCount", (cnf instanceof List<?> l) ? l.size() : 0);
            resumen.put("incidenciasCount", (inc instanceof List<?> l) ? l.size() : 0);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("jobId", job.id);
        out.put("estado", job.estado.name());
        out.put("codCliente", job.codCliente);
        out.put("nombreArchivo", job.nombreArchivo);
        out.put("creadoEpochMs", job.creadoEpochMs);
        out.put("inicioEpochMs", job.inicioEpochMs);
        out.put("finEpochMs", job.finEpochMs);
        out.put("error", job.error);
        out.put("resumen", resumen);
        return out;
    }

    public Map<String, Object> obtenerResultadoCargaExcelRMAsync(String jobId) {
        if (jobId == null || jobId.isBlank()) return Map.of("ok", false, "error", "jobId requerido");
        CargaAsyncJob job = cargaJobs.get(jobId);
        if (job == null) return Map.of("ok", false, "error", "jobId no encontrado");
        if (job.estado != EstadoCargaAsync.TERMINADO) {
            return obtenerEstadoCargaExcelRMAsync(jobId);
        }
        return job.resultado != null ? job.resultado : Map.of("ok", false, "error", "Sin resultado");
    }

    public ResponseEntity<Resource> descargarIncidenciasTxtAsync(String jobId) {
        if (jobId == null || jobId.isBlank()) {
            return ResponseEntity.badRequest().contentType(MediaType.APPLICATION_JSON).body(null);
        }
        CargaAsyncJob job = cargaJobs.get(jobId);
        if (job == null) {
            return ResponseEntity.notFound().build();
        }
        if (job.estado != EstadoCargaAsync.TERMINADO || job.resultado == null) {
            return ResponseEntity.status(409).build();
        }
        return generarIncidenciasTxt(job.nombreArchivo, job.resultado);
    }

    private void limpiarJobsViejos() {
        while (cargaJobsOrden.size() > MAX_JOBS_EN_MEMORIA) {
            String candidato = cargaJobsOrden.pollFirst();
            if (candidato == null) return;
            CargaAsyncJob j = cargaJobs.get(candidato);
            if (j == null) continue;
            if (j.estado == EstadoCargaAsync.PROCESANDO || j.estado == EstadoCargaAsync.PENDIENTE) {
                cargaJobsOrden.addLast(candidato);
                return;
            }
            cargaJobs.remove(candidato);
        }
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

    private static Integer findHeaderRowByGroups(Sheet sheet, List<Set<String>> requiredGroupsNorm, int maxScanRows) {
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

            boolean ok = true;
            for (Set<String> group : requiredGroupsNorm) {
                boolean groupOk = false;
                for (String opt : group) {
                    if (headers.contains(opt)) { groupOk = true; break; }
                }
                if (!groupOk) { ok = false; break; }
            }
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
    private void aplicarDatosSapCache(Venta v, SapCacheRow sap) {
        if (sap == null) return;
        v.setCodigoSap(sap.codigoSap);
        if (sap.codBarra != null && !sap.codBarra.isBlank()) v.setCodBarra(sap.codBarra.trim());
        v.setDescripcion(sap.descripcion);
        v.setNombreProducto(sap.descripcion);
        v.setMarca(sap.marca);
    }

    @Transactional
    protected Long crearProductoDesdeSapCache(String cb, SapCacheRow sap) {
        Optional<Long> ya = productoRepository.findIdByCodBarraSap(cb);
        if (ya.isPresent()) return ya.get();

        Producto p = new Producto();
        try { p.setCodBarraSap(cb); } catch (Exception ignore) {}

        Producto saved = productoRepository.save(p);
        productoRepository.flush();
        return saved.getId();
    }

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

    private Map<String, Long> findProductoIdsBatchByCodBarraSap(Collection<String> cods) {
        if (cods == null || cods.isEmpty()) return Map.of();

        List<Object[]> rows = productoRepository.findIdsByCodBarraSapIn(cods);

        Map<String, Long> out = new HashMap<>(rows.size() * 2);
        for (Object[] r : rows) {
            String cod = (String) r[0];
            Long id = (Long) r[1];
            if (cod != null && id != null) out.put(cod.trim(), id);
        }
        return out;
    }

    // ========================= Upsert VENTAS =========================
    // ✅ ACTUALIZA TAMBIÉN STOCK cuando existe (porque ya viene armado con la hoja STOCK)
    @Transactional
    protected void upsertVentasEnBloque(List<Venta> lote) {
        if (lote == null || lote.isEmpty()) return;
        Long clienteId = (lote.get(0).getCliente() != null) ? lote.get(0).getCliente().getId() : null;
        if (clienteId == null) return;
        upsertVentasEnBloqueOptimizado(clienteId, lote, new ArrayList<>());
    }

    private static String ventaKey(int anio, int mes, int dia, String codBarra, String codPdv) {
        String cb = (codBarra == null ? "" : codBarra.trim());
        String pdv = (codPdv == null ? "" : codPdv.trim());
        return anio + "|" + mes + "|" + dia + "|" + cb + "|" + pdv;
    }

    private void ejecutarUpsertEnTransaccion(Long clienteId, List<Venta> buffer, List<Incidencia> incidencias) {
        if (buffer == null || buffer.isEmpty()) return;
        if (clienteId == null) return;

        final int TX_CHUNK_SIZE = 1000;
        for (int base = 0; base < buffer.size(); base += TX_CHUNK_SIZE) {
            List<Venta> chunk = new ArrayList<>(buffer.subList(base, Math.min(base + TX_CHUNK_SIZE, buffer.size())));
            try {
                txTemplate.execute(status -> {
                    upsertVentasEnBloqueOptimizado(clienteId, chunk, incidencias);
                    return null;
                });
            } catch (Exception ex) {
                incidencias.add(new Incidencia("ERROR_BD_LOTE",
                        "Error BD procesando lote. " + (ex.getMessage() != null ? ex.getMessage() : ex.toString()),
                        -1, "GENERAL"));
                try { entityManager.clear(); } catch (Exception ignore) {}
            }
        }
    }

    private Map<String, Long> buscarIdsExistentesPorKey(Long clienteId, List<Venta> lote) {
        if (clienteId == null || lote == null || lote.isEmpty()) return Map.of();

        List<Venta> normalizadas = new ArrayList<>(lote.size());
        for (Venta v : lote) {
            if (v == null) continue;
            String cb = (v.getCodBarra() == null ? null : v.getCodBarra().trim());
            String pdv = tiendaKey(v.getCodPdv());
            v.setCodBarra(cb);
            v.setCodPdv(pdv);
            v.setPdv(pdv);
            normalizadas.add(v);
        }

        Map<String, Long> out = new HashMap<>(normalizadas.size() * 2);
        final int MAX_TUPLAS = 400;

        for (int base = 0; base < normalizadas.size(); base += MAX_TUPLAS) {
            List<Venta> sub = normalizadas.subList(base, Math.min(base + MAX_TUPLAS, normalizadas.size()));

            StringBuilder sql = new StringBuilder();
            sql.append("SELECT v.id, v.anio, v.mes, v.dia, v.cod_barra, v.cod_pdv ");
            sql.append("FROM SELLOUT.dbo.venta v ");
            sql.append("JOIN (VALUES ");

            for (int i = 0; i < sub.size(); i++) {
                if (i > 0) sql.append(",");
                sql.append("(:anio").append(i).append(", :mes").append(i).append(", :dia").append(i)
                        .append(", :cb").append(i).append(", :pdv").append(i).append(")");
            }

            sql.append(") AS x(anio, mes, dia, cod_barra, cod_pdv) ");
            sql.append("ON v.anio = x.anio AND v.mes = x.mes AND v.dia = x.dia ");
            sql.append("AND LTRIM(RTRIM(v.cod_barra)) = LTRIM(RTRIM(x.cod_barra)) ");
            sql.append("AND LTRIM(RTRIM(v.cod_pdv)) = LTRIM(RTRIM(x.cod_pdv)) ");
            sql.append("WHERE v.cliente_id = :cli");

            Query q = entityManager.createNativeQuery(sql.toString());
            q.setParameter("cli", clienteId);

            for (int i = 0; i < sub.size(); i++) {
                Venta v = sub.get(i);
                q.setParameter("anio" + i, v.getAnio());
                q.setParameter("mes" + i, v.getMes());
                q.setParameter("dia" + i, v.getDia());
                q.setParameter("cb" + i, v.getCodBarra());
                q.setParameter("pdv" + i, v.getCodPdv());
            }

            @SuppressWarnings("unchecked")
            List<Object[]> rows = q.getResultList();
            for (Object[] r : rows) {
                Long id = (r[0] instanceof Number n) ? n.longValue() : null;
                Integer anio = (r[1] instanceof Number n) ? n.intValue() : null;
                Integer mes = (r[2] instanceof Number n) ? n.intValue() : null;
                Integer dia = (r[3] instanceof Number n) ? n.intValue() : null;
                String cb = (String) r[4];
                String pdv = (String) r[5];
                if (id == null || anio == null || mes == null || dia == null) continue;
                out.put(ventaKey(anio, mes, dia, cb, pdv), id);
            }
        }

        return out;
    }

    private void upsertVentasEnBloqueOptimizado(Long clienteId, List<Venta> lote, List<Incidencia> incidencias) {
        if (clienteId == null || lote == null || lote.isEmpty()) return;

        Map<String, Long> existentes = buscarIdsExistentesPorKey(clienteId, lote);
        final int BATCH = 2000;
        int ops = 0;

        for (int i = 0; i < lote.size(); i++) {
            Venta v = lote.get(i);
            if (v == null) continue;

            String cb = (v.getCodBarra() == null ? null : v.getCodBarra().trim());
            String pdv = tiendaKey(v.getCodPdv());
            v.setCodBarra(cb);
            v.setCodPdv(pdv);
            v.setPdv(pdv);

            String key = ventaKey(
                    v.getAnio() != null ? v.getAnio() : 0,
                    v.getMes() != null ? v.getMes() : 0,
                    v.getDia(),
                    v.getCodBarra(),
                    v.getCodPdv()
            );

            Long idExistente = existentes.get(key);
            try {
                if (idExistente != null) {
                    ejecutarUpdateVentaPorId(idExistente, v);
                } else {
                    try {
                        Query ins = entityManager.createNativeQuery("""
                            INSERT INTO SELLOUT.dbo.venta
                                (anio, mes, dia, ciudad, marca,
                                 venta_dolares, venta_unidad,
                                 nombre_producto, codigo_sap,
                                 cod_barra, cod_pdv, descripcion, pdv,
                                 stock_dolares, stock_unidades,
                                 cliente_id, producto_id, unidades_diarias)
                            VALUES
                                (:anio, :mes, :dia, :ciudad, :marca,
                                 :ventaDolares, :ventaUnidad,
                                 :nombreProducto, :codigoSap,
                                 :codBarra, :codPdv, :descripcion, :pdv,
                                 :stockDolares, :stockUnidades,
                                 :clienteId, :productoId, :unidadesDiarias)
                            """);

                        ins.setParameter("anio", v.getAnio());
                        ins.setParameter("mes", v.getMes());
                        ins.setParameter("dia", v.getDia());
                        ins.setParameter("ciudad", v.getCiudad());
                        ins.setParameter("marca", v.getMarca());
                        ins.setParameter("ventaDolares", v.getVentaDolares());
                        ins.setParameter("ventaUnidad", v.getVentaUnidad());
                        ins.setParameter("nombreProducto", v.getNombreProducto());
                        ins.setParameter("codigoSap", v.getCodigoSap());
                        ins.setParameter("codBarra", v.getCodBarra());
                        ins.setParameter("codPdv", v.getCodPdv());
                        ins.setParameter("descripcion", v.getDescripcion());
                        ins.setParameter("pdv", v.getPdv());
                        ins.setParameter("stockDolares", v.getStockDolares());
                        ins.setParameter("stockUnidades", v.getStockUnidades());
                        ins.setParameter("clienteId", clienteId);
                        ins.setParameter("productoId", (v.getProducto() != null ? v.getProducto().getId() : null));
                        ins.setParameter("unidadesDiarias", v.getUnidadesDiarias());
                        ins.executeUpdate();
                    } catch (Exception exIns) {
                        if (esErrorClaveDuplicada(exIns)) {
                            Long idDb = buscarIdExistenteVenta(clienteId, v);
                            if (idDb != null) {
                                existentes.put(key, idDb);
                                ejecutarUpdateVentaPorId(idDb, v);
                            } else {
                                throw exIns;
                            }
                        } else {
                            throw exIns;
                        }
                    }
                }

            } catch (Exception ex) {
                int filaExcel = -1;
                if (v instanceof VentaConFilaExcel ve && ve.getFilaExcel() != null) filaExcel = ve.getFilaExcel();
                incidencias.add(new Incidencia(
                        (v.getCodBarra() == null || v.getCodBarra().isBlank()) ? "CODBARRA_VACIO" : v.getCodBarra(),
                        "Error BD al upsert. " + (ex.getMessage() != null ? ex.getMessage() : ex.toString()),
                        filaExcel,
                        "GENERAL"
                ));
                try { entityManager.clear(); } catch (Exception ignore) {}
            }

            ops++;
            if (ops % BATCH == 0) {
                try { entityManager.flush(); } catch (Exception ignore) {}
                try { entityManager.clear(); } catch (Exception ignore) {}
            }
        }

        try { entityManager.flush(); } catch (Exception ignore) {}
        try { entityManager.clear(); } catch (Exception ignore) {}
    }

    private void ejecutarUpdateVentaPorId(Long id, Venta v) {
        Query upd = entityManager.createNativeQuery("""
            UPDATE SELLOUT.dbo.venta
               SET ciudad = :ciudad,
                   marca = :marca,
                   venta_dolares = :ventaDolares,
                   venta_unidad = :ventaUnidad,
                   nombre_producto = :nombreProducto,
                   codigo_sap = :codigoSap,
                   descripcion = :descripcion,
                   pdv = :pdv,
                   stock_dolares = :stockDolares,
                   stock_unidades = :stockUnidades,
                   producto_id = :productoId
             WHERE id = :id
            """);

        upd.setParameter("ciudad", v.getCiudad());
        upd.setParameter("marca", v.getMarca());
        upd.setParameter("ventaDolares", v.getVentaDolares());
        upd.setParameter("ventaUnidad", v.getVentaUnidad());
        upd.setParameter("nombreProducto", v.getNombreProducto());
        upd.setParameter("codigoSap", v.getCodigoSap());
        upd.setParameter("descripcion", v.getDescripcion());
        upd.setParameter("pdv", v.getPdv());
        upd.setParameter("stockDolares", v.getStockDolares());
        upd.setParameter("stockUnidades", v.getStockUnidades());
        upd.setParameter("productoId", (v.getProducto() != null ? v.getProducto().getId() : null));
        upd.setParameter("id", id);
        upd.executeUpdate();
    }

    private Long buscarIdExistenteVenta(Long clienteId, Venta v) {
        if (clienteId == null || v == null) return null;
        if (v.getAnio() == null || v.getMes() == null || v.getDia() <= 0) return null;
        if (v.getCodBarra() == null || v.getCodBarra().isBlank()) return null;
        if (v.getCodPdv() == null || v.getCodPdv().isBlank()) return null;

        Query q = entityManager.createNativeQuery("""
            SELECT TOP 1 v.id
              FROM SELLOUT.dbo.venta v
             WHERE v.cliente_id = :cli
               AND v.anio = :anio
               AND v.mes = :mes
               AND v.dia = :dia
               AND LTRIM(RTRIM(v.cod_barra)) = LTRIM(RTRIM(:cb))
               AND LTRIM(RTRIM(v.cod_pdv)) = LTRIM(RTRIM(:pdv))
            """);
        q.setParameter("cli", clienteId);
        q.setParameter("anio", v.getAnio());
        q.setParameter("mes", v.getMes());
        q.setParameter("dia", v.getDia());
        q.setParameter("cb", v.getCodBarra());
        q.setParameter("pdv", v.getCodPdv());

        @SuppressWarnings("unchecked")
        List<Object> rows = q.getResultList();
        if (rows == null || rows.isEmpty()) return null;
        Object first = rows.get(0);
        return (first instanceof Number n) ? n.longValue() : null;
    }

    private boolean esErrorClaveDuplicada(Throwable ex) {
        Throwable cur = ex;
        while (cur != null) {
            if (cur instanceof SQLException sql) {
                int code = sql.getErrorCode();
                if (code == 2601 || code == 2627) return true;
                String st = sql.getSQLState();
                if (st != null && st.startsWith("23")) return true;
            }
            String msg = cur.getMessage();
            if (msg != null) {
                String m = msg.toLowerCase(Locale.ROOT);
                if (m.contains("ux_venta_natural") || m.contains("clave duplicada") || m.contains("duplicate")) return true;
            }
            cur = cur.getCause();
        }
        return false;
    }

    // ========================= STOCK (UPDATE seguro + log específico) =========================
    // (Se deja, pero YA NO se usa en cargarExcelRM porque ahora el stock se inserta junto con ventas)
    @Transactional
    protected void upsertStockEnBloque(Long clienteId, List<? extends Venta> loteStock, List<Incidencia> incidencias) {
        if (loteStock == null || loteStock.isEmpty()) return;

        final int BATCH = 2000;
        int i = 0;

        final String sqlUpd = """
            UPDATE SELLOUT.dbo.venta
               SET stock_unidades = :su,
                   stock_dolares  = :sd
             WHERE cliente_id = :cli
               AND anio = :anio AND mes = :mes AND dia = :dia
               AND cod_barra = :cb
               AND cod_pdv   = :cp
        """;

        for (Venta v : loteStock) {

            String cb = v.getCodBarra() == null ? null : v.getCodBarra().trim();
            String tienda = tiendaKey(v.getCodPdv());

            v.setCodBarra(cb);
            v.setCodPdv(tienda);
            v.setPdv(tienda);

            int filaExcel = -1;
            if (v instanceof VentaConFilaExcel ve && ve.getFilaExcel() != null) filaExcel = ve.getFilaExcel();

            if (cb == null || cb.isBlank()) {
                incidencias.add(new Incidencia("CODBARRA_VACIO",
                        "Error BD al actualizar STOCK: cod_barra vacío (no se ejecutó UPDATE).",
                        filaExcel, "STOCK"));
                continue;
            }

            double su = v.getStockUnidades();
            double sd = v.getStockDolares();

            try {
                int updated = entityManager.createNativeQuery(sqlUpd)
                        .setParameter("su", su)
                        .setParameter("sd", sd)
                        .setParameter("cli", clienteId)
                        .setParameter("anio", v.getAnio())
                        .setParameter("mes", v.getMes())
                        .setParameter("dia", v.getDia())
                        .setParameter("cb", cb)
                        .setParameter("cp", tienda)
                        .executeUpdate();

                if (updated == 0) {
                    incidencias.add(new Incidencia(cb,
                            "STOCK no actualizado: no existe venta en BD para hacer match (cliente/anio/mes/dia/cod_barra/cod_pdv).",
                            filaExcel, "STOCK"));
                }
            } catch (Exception ex) {
                String msg = (ex.getMessage() != null ? ex.getMessage() : ex.toString());
                incidencias.add(new Incidencia(cb,
                        "Error BD al actualizar STOCK. " +
                                "Datos: cli=" + clienteId +
                                " anio=" + v.getAnio() +
                                " mes=" + v.getMes() +
                                " dia=" + v.getDia() +
                                " tienda=" + tienda +
                                " su=" + su +
                                " sd=" + sd +
                                " | Detalle: " + msg,
                        filaExcel, "STOCK"));
            }

            i++;
            if (i % BATCH == 0) {
                entityManager.flush();
                entityManager.clear();
            }
        }

        entityManager.flush();
        entityManager.clear();
    }

    // ========================= Carga Excel RM (VENTAS + STOCK) =========================
    // ✅ Ahora: se arma un MAP de STOCK y se inserta junto con VENTAS (NO stock=0)
    public Map<String, Object> cargarExcelRM(InputStream inputStream, String codCliente, String nombreArchivo) {
        long t0 = System.nanoTime();

        Cliente cliente = getClienteOrThrow(codCliente);
        List<Incidencia> incidencias = new ArrayList<>();
        Set<String> codigosNoEncontrados = new HashSet<>();

        int filasLeidasVentas = 0, filasProcesadasVentas = 0;
        int filasLeidasStock  = 0, filasProcesadasStock  = 0;
        int filasInsertadasStockSinVentas = 0;
        int stockSinVentaOmitidosEnLog = 0;

        final int BUFFER_SIZE = 5000;

        try (Workbook wb = WorkbookFactory.create(inputStream)) {

            // ============================================================
            // PRE-SCAN: recolectar TODOS los códigos (para cache SAP/productos)
            // ============================================================
            Set<String> codigosParaBuscar = new HashSet<>();

            Sheet shVentas = wb.getSheet("VENTAS");
            if (shVentas == null) shVentas = wb.getSheetAt(0);

            Set<String> grpFecha = Set.of("fecha_venta", "fecha", "fecha_corte", "fecha_de_venta");
            Set<String> grpTienda = Set.of("nombre_tienda", "tienda", "pdv", "punto_de_venta", "nombre_pdv");
            Set<String> grpRef = Set.of("ref_proveedor", "ref", "cod_barra", "codigo_barra", "codigo_barras", "codigobarra", "cod_barra_sap", "codbarra");

            Integer headerVentas = findHeaderRowByGroups(shVentas, List.of(grpFecha, grpTienda, grpRef), 30);
            Map<String, Integer> hV = (headerVentas == null) ? Map.of() : buildHeaderIndex(shVentas, headerVentas);

            Integer cFechaV  = (headerVentas == null) ? null : pick(hV, "fecha_venta", "fecha", "fecha_corte", "fecha_de_venta");
            Integer cTiendaV = (headerVentas == null) ? null : pick(hV, "nombre_tienda", "tienda", "pdv", "punto_de_venta", "nombre_pdv");
            Integer cRefV    = (headerVentas == null) ? null : pick(hV, "ref_proveedor", "ref", "cod_barra", "codigo_barra", "codigo_barras", "codigobarra", "cod_barra_sap", "codbarra");
            Integer cUsdV    = (headerVentas == null) ? null : pick(hV, "ventas_en_usd_sin_iva", "venta_usd", "venta_dolares", "ventas_usd");
            Integer cUdsV    = (headerVentas == null) ? null : pick(hV, "ventas_en_udd", "ventas_en_uds", "venta_unidad", "venta_unidades", "ventas_unidades");
            Integer cMarcaV  = (headerVentas == null) ? null : pick(hV, "marca");
            Integer cNombreMaterialV = (headerVentas == null) ? null : pick(hV, "nombre_material", "descripcion", "descripcion_material");
            Integer cCodigoMaterialV = (headerVentas == null) ? null : pick(hV, "codigo_material", "codigo_sap", "codigo_producto");

            if (headerVentas != null) {
                for (int r = headerVentas + 1; r <= shVentas.getLastRowNum(); r++) {
                    Row row = shVentas.getRow(r);
                    if (row == null) continue;
                    String cb = getString(row, cRefV);
                    if (cb != null && !cb.isBlank()) codigosParaBuscar.add(cb.trim());
                }
            }

            Sheet shStock = wb.getSheet("STOCK");

            // ✅ STOCK usa fecha_venta (NO fecha_corte)
            Integer headerStock = null;
            Map<String, Integer> hS = Map.of();
            Integer cFechaS = null, cTiendaS = null, cRefS = null, cUnS = null, cDolS = null, cMarcaS = null, cNombreMaterialS = null, cCodigoMaterialS = null;

            if (shStock != null) {
                headerStock = findHeaderRowByGroups(shStock, List.of(grpFecha, grpTienda, grpRef), 30);
                if (headerStock != null) {
                    hS = buildHeaderIndex(shStock, headerStock);

                    cFechaS  = pick(hS, "fecha_venta", "fecha", "fecha_corte", "fecha_de_venta");
                    cTiendaS = pick(hS, "nombre_tienda", "tienda", "pdv", "punto_de_venta", "nombre_pdv");
                    cRefS    = pick(hS, "ref_proveedor", "ref", "cod_barra", "codigo_barra", "codigo_barras", "codigobarra", "cod_barra_sap", "codbarra");

                    cUnS  = pick(hS, "cantidad_unidades", "stock_unidades", "unidades");
                    cDolS = pick(hS, "cantidad_dolares", "stock_dolares", "dolares", "usd");
                    cMarcaS = pick(hS, "marca");
                    cNombreMaterialS = pick(hS, "nombre_material", "descripcion", "descripcion_material");
                    cCodigoMaterialS = pick(hS, "codigo_material", "codigo_sap", "codigo_producto");

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
            // 1) Construir MAP de STOCK por key (anio|mes|dia|cb|tienda)
            // ============================================================
            Map<String, StockInfo> stockByKey = new HashMap<>(200_000);

            if (shStock != null) {
                if (headerStock == null) {
                    incidencias.add(new Incidencia("GENERAL",
                            "No se encontró encabezado de STOCK (requiere fecha_venta, nombre_tienda, ref_proveedor).",
                            -1, "STOCK"));
                } else {
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
                                incidencias.add(new Incidencia("CODBARRA_VACIO",
                                        "ref_proveedor vacío. Fila omitida.",
                                        r + 1, "STOCK"));
                                continue;
                            }

                            String cb = codBarraSap.trim();

                            Double su = getDouble(row, cUnS);
                            Double sd = getDouble(row, cDolS);

                            double suVal = (su != null && Double.isFinite(su)) ? su : 0d;
                            double sdVal = (sd != null && Double.isFinite(sd)) ? sd : 0d;

                            String key = zdt.getYear() + "|" + zdt.getMonthValue() + "|" + zdt.getDayOfMonth() + "|" + cb + "|" + tienda;

                            // Si viene repetido, se queda el último (puedes cambiar a suma si deseas)
                            String marca = getString(row, cMarcaS);
                            String nombreMaterial = getString(row, cNombreMaterialS);
                            String codigoMaterial = getString(row, cCodigoMaterialS);
                            stockByKey.put(key, new StockInfo(
                                    suVal, sdVal, r + 1,
                                    (marca != null ? marca.trim() : null),
                                    (nombreMaterial != null ? nombreMaterial.trim() : null),
                                    (codigoMaterial != null ? codigoMaterial.trim() : null)
                            ));

                            filasProcesadasStock++;

                        } catch (Exception exFila) {
                            incidencias.add(new Incidencia("ERROR_FILA",
                                    "Error procesando fila: " + exFila.getMessage(),
                                    r + 1, "STOCK"));
                        }
                    }
                }
            }

            // ============================================================
            // 2) VENTAS: insertar/actualizar ya con stock real (si existe en STOCK)
            // ============================================================
            Set<String> keysVentas = new HashSet<>(200_000);

            if (headerVentas == null) {
                incidencias.add(new Incidencia("GENERAL",
                        "No se encontró encabezado de VENTAS (requiere fecha_venta, nombre_tienda, ref_proveedor).",
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
                            codigosNoEncontrados.add("CODBARRA_VACIO");
                            incidencias.add(new Incidencia("CODBARRA_VACIO",
                                    "ref_proveedor vacío. Fila omitida.",
                                    r + 1, "VENTAS"));
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
                                        r + 1, "VENTAS"));
                            } else {
                                productoId = PRODUCTO_FALLBACK_ID;
                                incidencias.add(new Incidencia(cb,
                                        "No existe en PRODUCTO ni en SAP_Prod_cache. Se carga con PRODUCTO_FALLBACK_ID=" + PRODUCTO_FALLBACK_ID,
                                        r + 1, "VENTAS"));
                            }
                        }

                        Double ventaUsd = getDouble(row, cUsdV);
                        Double ventaUds = getDouble(row, cUdsV);

                        VentaFila v = new VentaFila();
                        v.setFilaExcel(r + 1);
                        v.setCliente(cliente);

                        v.setAnio(zdt.getYear());
                        v.setMes(zdt.getMonthValue());
                        v.setDia(zdt.getDayOfMonth());

                        v.setCodBarra(cb);
                        v.setCodPdv(tienda);
                        v.setPdv(tienda);

                        v.setVentaDolares(ventaUsd != null ? ventaUsd : 0);
                        v.setVentaUnidad(ventaUds != null ? ventaUds : 0);

                        SapCacheRow sapVenta = sapMap.get(cb);
                        if (sapVenta != null) aplicarDatosSapCache(v, sapVenta);

                        String marcaExcel = getString(row, cMarcaV);
                        if (marcaExcel != null && !marcaExcel.isBlank()) v.setMarca(marcaExcel.trim());
                        String nombreMatExcel = getString(row, cNombreMaterialV);
                        if (nombreMatExcel != null && !nombreMatExcel.isBlank()) {
                            v.setNombreProducto(nombreMatExcel.trim());
                            v.setDescripcion(nombreMatExcel.trim());
                        }
                        String codMatExcel = getString(row, cCodigoMaterialV);
                        if (codMatExcel != null && !codMatExcel.isBlank()) v.setCodigoSap(codMatExcel.trim());

                        // ✅ AQUÍ el cambio: stock se toma del MAP de STOCK
                        String key = v.getAnio() + "|" + v.getMes() + "|" + v.getDia() + "|" + cb + "|" + tienda;
                        keysVentas.add(key);

                        StockInfo st = stockByKey.get(key);
                        if (st != null) {
                            v.setStockUnidades(st.su);
                            v.setStockDolares(st.sd);
                        } else {
                            // Si no hay stock, queda en 0 (pero ya es por ausencia real, no por diseño)
                            v.setStockUnidades(0);
                            v.setStockDolares(0);

                            incidencias.add(new Incidencia(cb,
                                    "No existe registro en hoja STOCK para esta venta (misma fecha_venta y tienda). Se insertó stock=0.",
                                    r + 1, "VENTAS"));
                        }

                        v.setUnidadesDiarias("0");

                        Producto p = new Producto();
                        p.setId(productoId);
                        v.setProducto(p);

                        buffer.add(v);
                        filasProcesadasVentas++;

                        if (buffer.size() >= BUFFER_SIZE) {
                            ejecutarUpsertEnTransaccion(cliente.getId(), buffer, incidencias);
                            buffer.clear();
                        }

                    } catch (Exception exFila) {
                        incidencias.add(new Incidencia("ERROR_FILA",
                                "Error procesando fila: " + exFila.getMessage(),
                                r + 1, "VENTAS"));
                    }
                }

                if (!buffer.isEmpty()) ejecutarUpsertEnTransaccion(cliente.getId(), buffer, incidencias);
            }

            // ============================================================
            // 3) Insertar STOCK sin match en VENTAS como venta=0
            // ============================================================
            if (!stockByKey.isEmpty()) {
                List<Venta> bufferStockOnly = new ArrayList<>(BUFFER_SIZE);
                final int MAX_LOG_STOCK_SIN_VENTA = 200;
                for (Map.Entry<String, StockInfo> e : stockByKey.entrySet()) {
                    String key = e.getKey();
                    if (keysVentas.contains(key)) continue;

                    String[] parts = key.split("\\|", -1);
                    if (parts.length < 5) continue;

                    Integer anio = null, mes = null, dia = null;
                    try { anio = Integer.parseInt(parts[0]); } catch (Exception ignore) {}
                    try { mes = Integer.parseInt(parts[1]); } catch (Exception ignore) {}
                    try { dia = Integer.parseInt(parts[2]); } catch (Exception ignore) {}

                    String cb = parts[3] != null ? parts[3].trim() : null;
                    String tienda = parts[4] != null ? parts[4].trim() : null;
                    if (cb == null || cb.isBlank()) continue;
                    if (anio == null || mes == null || dia == null) continue;

                    Long productoId = productoIdMap.get(cb);
                    if (productoId == null) {
                        codigosNoEncontrados.add(cb);

                        SapCacheRow sap = sapMap.get(cb);
                        if (sap != null) {
                            productoId = crearProductoDesdeSapCache(cb, sap);
                            productoIdMap.put(cb, productoId);

                            incidencias.add(new Incidencia(cb,
                                    "No existía en PRODUCTO. Se creó desde SAP_Prod_cache con id=" + productoId,
                                    e.getValue().filaExcel, "STOCK"));
                        } else {
                            productoId = PRODUCTO_FALLBACK_ID;
                            incidencias.add(new Incidencia(cb,
                                    "No existe en PRODUCTO ni en SAP_Prod_cache. Se carga con PRODUCTO_FALLBACK_ID=" + PRODUCTO_FALLBACK_ID,
                                    e.getValue().filaExcel, "STOCK"));
                        }
                    }

                    VentaFila v = new VentaFila();
                    v.setFilaExcel(e.getValue().filaExcel);
                    v.setCliente(cliente);
                    v.setAnio(anio);
                    v.setMes(mes);
                    v.setDia(dia);

                    v.setCodBarra(cb);
                    String tiendaKey = tiendaKey(tienda);
                    v.setCodPdv(tiendaKey);
                    v.setPdv(tiendaKey);

                    v.setVentaDolares(0);
                    v.setVentaUnidad(0);

                    v.setStockUnidades(e.getValue().su);
                    v.setStockDolares(e.getValue().sd);

                    SapCacheRow sapVenta = sapMap.get(cb);
                    if (sapVenta != null) aplicarDatosSapCache(v, sapVenta);

                    StockInfo st = e.getValue();
                    if (st.marca != null && !st.marca.isBlank()) v.setMarca(st.marca.trim());
                    if (st.nombreMaterial != null && !st.nombreMaterial.isBlank()) {
                        v.setNombreProducto(st.nombreMaterial.trim());
                        v.setDescripcion(st.nombreMaterial.trim());
                    }
                    if (st.codigoMaterial != null && !st.codigoMaterial.isBlank()) v.setCodigoSap(st.codigoMaterial.trim());

                    v.setUnidadesDiarias("0");

                    Producto p = new Producto();
                    p.setId(productoId);
                    v.setProducto(p);

                    bufferStockOnly.add(v);
                    filasInsertadasStockSinVentas++;
                    if (filasInsertadasStockSinVentas <= MAX_LOG_STOCK_SIN_VENTA) {
                        incidencias.add(new Incidencia(cb,
                                "Existe en STOCK pero no existe en VENTAS para la misma fecha_venta+tienda+ref_proveedor. Se insertó con venta=0.",
                                e.getValue().filaExcel, "STOCK"));
                    } else {
                        stockSinVentaOmitidosEnLog++;
                    }

                    if (bufferStockOnly.size() >= BUFFER_SIZE) {
                        ejecutarUpsertEnTransaccion(cliente.getId(), bufferStockOnly, incidencias);
                        bufferStockOnly.clear();
                    }
                }
                if (!bufferStockOnly.isEmpty()) ejecutarUpsertEnTransaccion(cliente.getId(), bufferStockOnly, incidencias);
                if (stockSinVentaOmitidosEnLog > 0) {
                    incidencias.add(new Incidencia("STOCK_SIN_VENTA",
                            "Se insertaron más filas de STOCK sin venta. Omitidas en el log: " + stockSinVentaOmitidosEnLog,
                            -1, "STOCK"));
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
        out.put("filasInsertadasStockSinVentas", filasInsertadasStockSinVentas);

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

        sb.append("\nINCIDENCIAS_DETALLE").append('\n');
        if (incidencias == null || incidencias.isEmpty()) {
            sb.append("(sin incidencias)\n");
        } else {
            for (int i = 0; i < incidencias.size(); i++) {
                Incidencia inc = incidencias.get(i);
                sb.append("  ").append(i + 1).append(". ").append(inc.toString()).append('\n');
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

    public List<String> obtenerMarcasDisponibles(String codCliente) {
        String sql = "SELECT DISTINCT v.marca FROM venta v " +
                     "JOIN cliente c ON c.id = v.cliente_id " +
                     "WHERE c.cod_Cliente = :cod " +
                     "AND v.marca IS NOT NULL AND v.marca <> '' " +
                     "ORDER BY v.marca";
        Query q = entityManager.createNativeQuery(sql);
        q.setParameter("cod", codCliente);
        @SuppressWarnings("unchecked")
        List<String> res = q.getResultList();
        return res;
    }

    public List<Integer> obtenerAniosDisponibles(String codCliente) {
        String sql = "SELECT DISTINCT v.anio FROM venta v " +
                     "JOIN cliente c ON c.id = v.cliente_id " +
                     "WHERE c.cod_Cliente = :cod " +
                     "AND v.anio IS NOT NULL " +
                     "ORDER BY v.anio";
        Query q = entityManager.createNativeQuery(sql);
        q.setParameter("cod", codCliente);
        @SuppressWarnings("unchecked")
        List<Integer> res = q.getResultList();
        return res;
    }

    public List<Integer> obtenerMesesDisponibles(String codCliente, Integer anio) {
        String sql = "SELECT DISTINCT v.mes FROM venta v " +
                     "JOIN cliente c ON c.id = v.cliente_id " +
                     "WHERE c.cod_Cliente = :cod " +
                     "AND v.mes IS NOT NULL ";
        if (anio != null) {
            sql += "AND v.anio = :anio ";
        }
        sql += "ORDER BY v.mes";
        
        Query q = entityManager.createNativeQuery(sql);
        q.setParameter("cod", codCliente);
        if (anio != null) q.setParameter("anio", anio);
        
        @SuppressWarnings("unchecked")
        List<Integer> res = q.getResultList();
        return res;
    }

    public List<Map<String, Object>> obtenerVentasResumen(
            Integer anio,
            Integer mes,
            String marca,
            Integer limit,
            Integer offset
    ) {
        return obtenerVentasResumenPorCodCliente(DEFAULT_COD_CLIENTE, anio, mes, marca, null, null, limit, offset);
    }

    public List<Map<String, Object>> obtenerVentasResumenPorCodCliente(
            String codCliente,
            Integer anio,
            Integer mes,
            String marca,
            LocalDate fechaDesde,
            LocalDate fechaHasta,
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
        if (fechaDesde != null) sql.append("AND DATEFROMPARTS(v.anio, v.mes, v.dia) >= :fechaDesde ");
        if (fechaHasta != null) sql.append("AND DATEFROMPARTS(v.anio, v.mes, v.dia) <= :fechaHasta ");

        sql.append("ORDER BY v.anio DESC, v.mes DESC, v.dia DESC, v.id DESC ")
           .append("OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY");

        Query q = entityManager.createNativeQuery(sql.toString());
        q.setParameter("cod", codCliente);
        if (anio != null) q.setParameter("anio", anio);
        if (mes != null) q.setParameter("mes", mes);
        if (marca != null && !marca.isBlank()) q.setParameter("marca", marca.trim());
        if (fechaDesde != null) q.setParameter("fechaDesde", java.sql.Date.valueOf(fechaDesde));
        if (fechaHasta != null) q.setParameter("fechaHasta", java.sql.Date.valueOf(fechaHasta));
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

    public List<Map<String, Object>> obtenerVentasResumenPorCodCliente(
            String codCliente,
            Integer anio,
            Integer mes,
            String marca,
            Integer limit,
            Integer offset
    ) {
        return obtenerVentasResumenPorCodCliente(codCliente, anio, mes, marca, null, null, limit, offset);
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
        nuevaVenta.setCliente(cliente);

        return ventaRepository.findById(id).map(v -> {
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

    public void escribirReporteVentasZip(java.io.OutputStream os, String codCliente, Integer anio, Integer mes, String marca) {
        final int PAGE_SIZE = 10000;
        final int MAX_FILAS_POR_CSV = 100000;

        String cod = (codCliente == null || codCliente.isBlank()) ? DEFAULT_COD_CLIENTE : codCliente.trim();
        String marcaNorm = (marca == null || marca.isBlank()) ? null : marca.trim();

        try (java.util.zip.ZipOutputStream zip = new java.util.zip.ZipOutputStream(os)) {
            int parte = 1;
            long filasParte = 0;

            java.io.BufferedWriter bw = null;
            try {
                bw = abrirCsvEnZip(zip, parte);
                escribirHeaderCsvRm(bw);

                long offset = 0;
                while (true) {
                    StringBuilder sql = new StringBuilder();
                    java.util.List<Object> args = new java.util.ArrayList<>();

                    sql.append("SELECT v.id, v.anio, v.mes, v.dia, v.marca, v.nombre_Producto, v.cod_Barra, v.codigo_Sap, v.descripcion, ");
                    sql.append("v.cod_Pdv, v.pdv, v.ciudad, v.stock_Dolares, v.stock_Unidades, v.venta_Dolares, v.venta_Unidad, ");
                    sql.append("c.cod_Cliente, c.nombre_Cliente ");
                    sql.append("FROM [SELLOUT].[dbo].[venta] v ");
                    sql.append("JOIN [SELLOUT].[dbo].[cliente] c ON c.id = v.cliente_id ");
                    sql.append("WHERE c.cod_Cliente = ? ");
                    args.add(cod);

                    if (anio != null) {
                        sql.append("AND v.anio = ? ");
                        args.add(anio);
                    }
                    if (mes != null) {
                        sql.append("AND v.mes = ? ");
                        args.add(mes);
                    }
                    if (marcaNorm != null) {
                        sql.append("AND LTRIM(RTRIM(v.marca)) = LTRIM(RTRIM(?)) ");
                        args.add(marcaNorm);
                    }

                    sql.append("ORDER BY v.anio DESC, v.mes DESC, v.dia DESC, v.id DESC ");
                    sql.append("OFFSET ? ROWS FETCH NEXT ? ROWS ONLY ");
                    args.add(offset);
                    args.add(PAGE_SIZE);

                    java.util.List<Object[]> rows = jdbcTemplate.query(
                            sql.toString(),
                            args.toArray(),
                            (rs, rowNum) -> new Object[]{
                                    rs.getObject(1),
                                    rs.getObject(2),
                                    rs.getObject(3),
                                    rs.getObject(4),
                                    rs.getObject(5),
                                    rs.getObject(6),
                                    rs.getObject(7),
                                    rs.getObject(8),
                                    rs.getObject(9),
                                    rs.getObject(10),
                                    rs.getObject(11),
                                    rs.getObject(12),
                                    rs.getObject(13),
                                    rs.getObject(14),
                                    rs.getObject(15),
                                    rs.getObject(16),
                                    rs.getObject(17),
                                    rs.getObject(18),
                            }
                    );

                    if (rows.isEmpty()) break;

                    for (Object[] r : rows) {
                        if (filasParte >= MAX_FILAS_POR_CSV) {
                            bw.flush();
                            zip.closeEntry();

                            parte++;
                            filasParte = 0;

                            bw = abrirCsvEnZip(zip, parte);
                            escribirHeaderCsvRm(bw);
                        }

                        StringBuilder line = new StringBuilder();
                        line.append(toCsv(r[0])).append(',').append(toCsv(r[1])).append(',').append(toCsv(r[2])).append(',').append(toCsv(r[3])).append(',');
                        line.append(toCsv(r[4])).append(',').append(toCsv(r[5])).append(',').append(toCsv(r[6])).append(',').append(toCsv(r[7])).append(',');
                        line.append(toCsv(r[8])).append(',').append(toCsv(r[9])).append(',').append(toCsv(r[10])).append(',').append(toCsv(r[11])).append(',');
                        line.append(toCsv(r[12])).append(',').append(toCsv(r[13])).append(',').append(toCsv(r[14])).append(',').append(toCsv(r[15])).append(',');
                        line.append(toCsv(r[16])).append(',').append(toCsv(r[17]));
                        bw.write(line.toString());
                        bw.newLine();
                        filasParte++;
                    }

                    bw.flush();
                    offset += rows.size();
                }

                bw.flush();
                zip.closeEntry();
            } finally {
                if (bw != null) {
                    try { bw.flush(); } catch (Exception ignore) {}
                }
            }
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

    private java.io.BufferedWriter abrirCsvEnZip(java.util.zip.ZipOutputStream zip, int parte) throws java.io.IOException {
        String nombre = String.format(java.util.Locale.ROOT, "rm_ventas_part_%03d.csv", parte);
        zip.putNextEntry(new java.util.zip.ZipEntry(nombre));
        java.io.OutputStreamWriter osw = new java.io.OutputStreamWriter(zip, java.nio.charset.StandardCharsets.UTF_8);
        java.io.BufferedWriter bw = new java.io.BufferedWriter(osw);
        bw.write("\uFEFF");
        return bw;
    }

    private void escribirHeaderCsvRm(java.io.BufferedWriter bw) throws java.io.IOException {
        bw.write("id,anio,mes,dia,marca,nombreProducto,codBarra,codigoSap,descripcion,codPdv,pdv,ciudad,stockDolares,stockUnidades,ventaDolares,ventaUnidad,codCliente,nombreCliente");
        bw.newLine();
    }
}
