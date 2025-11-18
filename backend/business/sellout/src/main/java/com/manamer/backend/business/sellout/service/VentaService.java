package com.manamer.backend.business.sellout.service;

import com.manamer.backend.business.sellout.models.Cliente;
import com.manamer.backend.business.sellout.models.Producto;
import com.manamer.backend.business.sellout.models.Venta;
import com.manamer.backend.business.sellout.repositories.VentaRepository;

import jakarta.persistence.EntityManager;
import jakarta.persistence.NoResultException;
import jakarta.persistence.NonUniqueResultException;
import jakarta.persistence.Query;
import jakarta.persistence.TypedQuery;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.BufferedWriter;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.StandardOpenOption;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.logging.Logger;
import java.util.stream.Collectors;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

import java.io.InputStream;

import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.ss.usermodel.WorkbookFactory;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DateUtil;
import org.apache.poi.ss.usermodel.Row;

@Service
public class VentaService {

    private final VentaRepository ventaRepository;
    private final EntityManager entityManager;
    private static final Logger log = Logger.getLogger(VentaService.class.getName());
    private static final ZoneId ZONE = ZoneId.systemDefault();

    // ===== NUEVO: estructura de incidencias para el TXT/JS =====
    public static final class Incidencia {
        public final String codigo;
        public final String motivo;
        public final int fila;
        public Incidencia(String codigo, String motivo, int fila) {
            this.codigo = codigo; this.motivo = motivo; this.fila = fila;
        }
    }

    @Autowired
    public VentaService(VentaRepository ventaRepository, EntityManager entityManager) {
        this.ventaRepository = ventaRepository;
        this.entityManager = entityManager;
    }

    // ============================================================
    // =============== OPTIMIZACIÓN: UPSERT EN LOTE ===============
    // ============================================================

    private static String safe(String s) { return (s == null ? "" : s.trim()); }

    private static String key(int anio, int mes, Integer dia, String codBarra, String codPdv, Long clienteId) {
        return anio + "|" + mes + "|" + (dia == null ? "" : dia) + "|" +
               safe(codBarra) + "|" + safe(codPdv) + "|" + (clienteId == null ? "" : clienteId);
    }

    private static class Counts { int inserts; int updates; }

    @Transactional
    protected Counts guardarVentasEnBloque(List<Venta> lote) {
        Counts counts = new Counts();
        if (lote == null || lote.isEmpty()) return counts;

        Map<String, Venta> porClave = new LinkedHashMap<>();
        Set<Integer> anios = new HashSet<>();
        Set<Integer> meses = new HashSet<>();
        Set<Integer> dias = new HashSet<>();
        Set<String> barras = new HashSet<>();
        Set<String> pdvs = new HashSet<>();
        Set<Long> clientes = new HashSet<>();

        for (Venta v : lote) {
            Long clienteId = (v.getCliente() != null ? v.getCliente().getId() : null);
            Integer diaKey = (v.getDia() > 0 ? Integer.valueOf(v.getDia()) : null);
            String k = key(v.getAnio(), v.getMes(), diaKey, v.getCodBarra(), v.getCodPdv(), clienteId);
            porClave.put(k, v);

            if (v.getAnio() != null) anios.add(v.getAnio());
            if (v.getMes() != null) meses.add(v.getMes());
            int diaVal = v.getDia();
            if (diaVal > 0) dias.add(diaVal);
            if (v.getCodBarra() != null) barras.add(safe(v.getCodBarra()));
            if (v.getCodPdv() != null) pdvs.add(safe(v.getCodPdv()));
            if (clienteId != null) clientes.add(clienteId);
        }

        List<Object[]> existentesRaw = new ArrayList<>();
        if (!anios.isEmpty() && !meses.isEmpty() && !barras.isEmpty()) {
            String sql = """
                SELECT id, anio, mes, dia, cod_barra, cod_pdv, cliente_id
                FROM [SELLOUT].[dbo].[venta]
                WHERE anio IN (:anios)
                  AND mes  IN (:meses)
                  AND cod_barra IN (:barras)
                  AND ( :usarDias = 0 OR dia IN (:dias) )
                  AND ( :usarPdvs = 0 OR cod_pdv IN (:pdvs) )
                  AND ( :usarClientes = 0 OR cliente_id IN (:clientes) )
            """;
            Query q = entityManager.createNativeQuery(sql);
            q.setParameter("anios", anios);
            q.setParameter("meses", meses);
            q.setParameter("barras", barras);
            q.setParameter("usarDias", dias.isEmpty() ? 0 : 1);
            q.setParameter("dias", dias.isEmpty() ? List.of(-1) : dias);
            q.setParameter("usarPdvs", pdvs.isEmpty() ? 0 : 1);
            q.setParameter("pdvs", pdvs.isEmpty() ? List.of("_NULL_") : pdvs);
            q.setParameter("usarClientes", clientes.isEmpty() ? 0 : 1);
            q.setParameter("clientes", clientes.isEmpty() ? List.of(-1L) : clientes);
            @SuppressWarnings("unchecked")
            List<Object[]> res = q.getResultList();
            existentesRaw = res;
        }

        Map<String, Long> claveAId = new LinkedHashMap<>();
        for (Object[] r : existentesRaw) {
            Long id   = ((Number) r[0]).longValue();
            Integer an = (Integer) r[1];
            Integer me = (Integer) r[2];
            Integer di = (r[3] == null ? null : ((Number) r[3]).intValue());
            String cb  = (String)  r[4];
            String cp  = (String)  r[5];
            Long cliId = (r[6] == null ? null : ((Number) r[6]).longValue());
            String k = key(an, me, di, cb, cp, cliId);
            claveAId.put(k, id);
        }

        List<Venta> inserts = new ArrayList<>();
        List<Venta> updates = new ArrayList<>();
        for (Venta v : porClave.values()) {
            Long clienteId = (v.getCliente() != null ? v.getCliente().getId() : null);
            Integer diaKey = (v.getDia() > 0 ? Integer.valueOf(v.getDia()) : null);
            String k = key(v.getAnio(), v.getMes(), diaKey, v.getCodBarra(), v.getCodPdv(), clienteId);
            Long id = claveAId.get(k);
            if (id != null) {
                v.setId(id);
                updates.add(v);
            } else {
                inserts.add(v);
            }
        }

        counts.inserts = inserts.size();
        counts.updates = updates.size();

        final int BATCH = 1_000;
        batchSave(inserts, BATCH);
        batchSave(updates, BATCH);

        return counts;
    }

    private void batchSave(List<Venta> list, int batch) {
        for (int i = 0; i < list.size(); i++) {
            ventaRepository.save(list.get(i));
            if ((i + 1) % batch == 0) {
                ventaRepository.flush();
                entityManager.clear();
            }
        }
        if (!list.isEmpty()) {
            ventaRepository.flush();
            entityManager.clear();
        }
    }

    // ============================================================
    // ===================== LÓGICA EXISTENTE =====================
    // ============================================================

    public boolean cargarDatosDeProducto(Venta venta, Set<String> codigosNoEncontrados) {
        String codItem = venta.getCodBarra();
        if (codItem == null || codItem.trim().isEmpty()) return false;
        codItem = codItem.trim();

        try {
            String queryStr = """
                SELECT TOP 1
                    c.id AS ClienteID, c.cod_Cliente, c.nombre_Cliente, c.ciudad, c.codigo_Proveedor,
                    p.id AS IdProducto, p.cod_Item, p.cod_Barra_Sap,
                    sp.CodProd, sp.CodBarra, sp.Descripcion, sp.Marca
                FROM SELLOUT.dbo.producto p
                LEFT JOIN SAPHANA..CG3_360CORP.SAP_Prod sp ON sp.CodBarra = p.cod_Barra_Sap
                CROSS JOIN (SELECT TOP 1 * FROM SELLOUT.dbo.cliente) c
                WHERE p.cod_Item = :codItem
            """;
            Query query = entityManager.createNativeQuery(queryStr);
            query.setParameter("codItem", codItem);

            @SuppressWarnings("unchecked")
            List<Object[]> results = query.getResultList();
            if (results.isEmpty()) {
                codigosNoEncontrados.add(codItem);
                return false;
            }
            Object[] result = results.get(0);
            if (result.length == 12) {
                venta.setCliente(new Cliente());
                venta.getCliente().setId(((Number) result[0]).longValue());
                venta.getCliente().setCodCliente((String) result[1]);
                venta.getCliente().setNombreCliente((String) result[2]);
                venta.getCliente().setCiudad((String) result[3]);
                venta.getCliente().setCodigoProveedor((String) result[4]);

                venta.setProducto(new Producto());
                venta.getProducto().setId(((Number) result[5]).longValue());
                venta.getProducto().setCodItem((String) result[6]);
                venta.getProducto().setCodBarraSap((String) result[7]);

                venta.setCodigoSap((String) result[8]);
                venta.setCodBarra(((String) result[9]).trim());
                venta.setDescripcion((String) result[10]);
                venta.setNombreProducto((String) result[10]);
                venta.setMarca((String) result[11]);
                return true;
            }
        } catch (NoResultException | NonUniqueResultException e) {
            guardarCodigoNoEncontrado(codItem);
            return false;
        } catch (Exception e) {
            guardarCodigoNoEncontrado(codItem);
            return false;
        }
        return false;
    }

    public boolean cargarDatosDeProductoDeprati(Venta venta, Set<String> codigosNoEncontrados) {
        String codBarra = venta.getCodBarra();
        if (codBarra == null || codBarra.trim().isEmpty()) return false;
        codBarra = codBarra.trim();

        try {
            String queryStr = """
                SELECT TOP 1
                    c.id AS ClienteID, c.cod_Cliente, c.nombre_Cliente, c.ciudad, c.codigo_Proveedor,
                    p.id AS IdProducto, p.cod_Item, p.cod_Barra_Sap,
                    sp.CodProd, sp.CodBarra, sp.Descripcion, sp.Marca
                FROM SELLOUT.dbo.producto p
                LEFT JOIN SAPHANA..CG3_360CORP.SAP_Prod sp ON sp.CodBarra = p.cod_Barra_Sap
                JOIN SELLOUT.dbo.cliente c ON c.cod_Cliente = :codCliente
                WHERE (p.cod_Barra_Sap = :codBarra OR sp.CodBarra = :codBarra OR p.cod_Item = :codBarra)
            """;
            Query query = entityManager.createNativeQuery(queryStr);
            query.setParameter("codCliente", "MZCL-000009");
            query.setParameter("codBarra", codBarra);
            @SuppressWarnings("unchecked")
            List<Object[]> results = query.getResultList();
            if (results.isEmpty()) {
                codigosNoEncontrados.add(codBarra);
                return false;
            }
            Object[] result = results.get(0);
            if (result.length == 12) {
                Cliente cliente = new Cliente();
                cliente.setId(((Number) result[0]).longValue());
                cliente.setCodCliente((String) result[1]);
                cliente.setNombreCliente((String) result[2]);
                cliente.setCiudad((String) result[3]);
                cliente.setCodigoProveedor((String) result[4]);
                venta.setCliente(cliente);

                Producto producto = new Producto();
                producto.setId(((Number) result[5]).longValue());
                producto.setCodItem((String) result[6]);
                producto.setCodBarraSap((String) result[7]);
                venta.setProducto(producto);

                venta.setCodigoSap((String) result[8]);
                venta.setCodBarra(((String) result[9]).trim());
                venta.setDescripcion((String) result[10]);
                venta.setNombreProducto((String) result[10]);
                venta.setMarca((String) result[11]);
                return true;
            }
        } catch (Exception e) {
            e.printStackTrace();
            guardarCodigoNoEncontrado(codBarra);
        }
        return false;
    }

    private static final String CARPETA_CODIGOS = "/creacion-codigos";

    private void guardarCodigoNoEncontrado(String codItem) {
        String downloadPath = Paths.get(CARPETA_CODIGOS, "codigos_no_encontrados.txt").toString();
        try (BufferedWriter writer = Files.newBufferedWriter(Paths.get(downloadPath),
                StandardOpenOption.CREATE, StandardOpenOption.APPEND)) {
            writer.write(Objects.toString(codItem, "NULL"));
            writer.newLine();
        } catch (IOException e) {
            System.err.println("Error al guardar código no encontrado: " + e.getMessage());
        }
    }

    public ResponseEntity<Resource> obtenerArchivoCodigosNoEncontrados(List<String> codigosNoEncontrados) {
        List<String> depurados = (codigosNoEncontrados == null ? List.<String>of() : codigosNoEncontrados).stream()
                .filter(Objects::nonNull).map(String::trim).filter(s -> !s.isEmpty())
                .distinct().sorted().collect(Collectors.toList());

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
                LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")) + ".txt";

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + filename)
                .header("X-Empty-File", Boolean.toString(empty))
                .contentType(MediaType.TEXT_PLAIN)
                .contentLength(bytes.length)
                .body(resource);
    }

    // ===== NUEVO: TXT de incidencias con métricas y timestamp =====
    public ResponseEntity<Resource> generarIncidenciasTxt(
            String nombreArchivoOrigen,
            int filasLeidas,
            int filasProcesadas,
            List<Incidencia> incidencias) {

        String ts = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        StringBuilder sb = new StringBuilder();
        sb.append("INCIDENCIAS DE CARGA").append('\n')
          .append("Archivo: ").append(Objects.toString(nombreArchivoOrigen, "")).append('\n')
          .append("Fecha/Hora: ").append(ts).append('\n')
          .append("Filas leídas: ").append(filasLeidas).append('\n')
          .append("Filas procesadas: ").append(filasProcesadas).append('\n')
          .append("Incidencias: ").append(incidencias == null ? 0 : incidencias.size()).append("\n\n")
          .append("CODIGO\tMOTIVO\tFILA\n");

        if (incidencias != null && !incidencias.isEmpty()) {
            for (Incidencia inc : incidencias) {
                sb.append(Objects.toString(inc.codigo, ""))
                  .append('\t')
                  .append(Objects.toString(inc.motivo, ""))
                  .append('\t')
                  .append(inc.fila)
                  .append('\n');
            }
        } else {
            sb.append("Sin incidencias.\n");
        }

        byte[] bytes = sb.toString().getBytes(StandardCharsets.UTF_8);
        InputStreamResource resource = new InputStreamResource(new ByteArrayInputStream(bytes));
        String filename = "incidencias_carga_" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")) + ".txt";

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=" + filename)
                .contentType(MediaType.TEXT_PLAIN)
                .contentLength(bytes.length)
                .body(resource);
    }

    // ===== NUEVO: validación de existencia en SAP por codBarra =====
    private boolean codBarraExisteEnSap(String codBarra) {
        if (codBarra == null || codBarra.trim().isEmpty()) return false;

        // Opción A: usa el repositorio si agregaste existsSapByCodBarra
        try {
            return ventaRepository.codBarraExisteEnSap(codBarra.trim());
        } catch (Throwable ignore) {
            // Opción B: fallback con EntityManager
            String sql = "SELECT TOP 1 1 FROM SAPHANA..CG3_360CORP.SAP_Prod WHERE CodBarra = :cb";
            try {
                Object r = entityManager.createNativeQuery(sql)
                        .setParameter("cb", codBarra.trim())
                        .getSingleResult();
                return r != null;
            } catch (Exception e) {
                return false;
            }
        }
    }

    // =================== Lectura genérica desde Excel ===================

    private String obtenerValorCeldaComoString(Row fila, Integer columnaIndex) {
        if (columnaIndex == null) return null;
        Cell celda = fila.getCell(columnaIndex);
        if (celda == null) return null;

        switch (celda.getCellType()) {
            case STRING: return celda.getStringCellValue().trim();
            case NUMERIC:
                if (DateUtil.isCellDateFormatted(celda)) {
                    LocalDate d = celda.getDateCellValue().toInstant().atZone(ZONE).toLocalDate();
                    return d.toString();
                }
                return String.valueOf((long) celda.getNumericCellValue());
            case BOOLEAN: return String.valueOf(celda.getBooleanCellValue());
            case FORMULA: return celda.getCellFormula();
            default: return "";
        }
    }

    private Double obtenerValorCeldaComoDouble(Row fila, Integer columnaIndex) {
        if (columnaIndex == null) return null;
        Cell celda = fila.getCell(columnaIndex);
        if (celda == null) return null;

        if (celda.getCellType() == CellType.NUMERIC) {
            return celda.getNumericCellValue();
        } else if (celda.getCellType() == CellType.STRING) {
            try {
                String s = celda.getStringCellValue();
                if (s == null) return null;
                s = s.trim().replace(",", ".");
                if (s.isEmpty()) return null;
                return Double.parseDouble(s);
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private Date obtenerFechaCelda(Row fila, Integer columnaIndex) {
        if (columnaIndex == null) return null;
        Cell celda = fila.getCell(columnaIndex);
        if (celda == null) return null;
        try {
            if (celda.getCellType() == CellType.NUMERIC && DateUtil.isCellDateFormatted(celda)) {
                return celda.getDateCellValue();
            } else if (celda.getCellType() == CellType.NUMERIC) {
                return DateUtil.getJavaDate(celda.getNumericCellValue());
            } else if (celda.getCellType() == CellType.STRING) {
                String s = celda.getStringCellValue();
                if (s == null) return null;
                s = s.trim();
                if (s.isEmpty()) return null;

                int spaceIdx = s.indexOf(' ');
                if (spaceIdx > 0) s = s.substring(0, spaceIdx);
                int tIdx = s.indexOf('T');
                if (tIdx > 0) s = s.substring(0, tIdx);

                LocalDate ld = tryParseLocalDate(s);
                if (ld != null) {
                    return Date.from(ld.atStartOfDay(ZONE).toInstant());
                }
            }
        } catch (Exception ignore) {}
        return null;
    }

    private static final List<java.time.format.DateTimeFormatter> DATE_FORMATS = List.of(
            java.time.format.DateTimeFormatter.ofPattern("dd/MM/uuuu"),
            java.time.format.DateTimeFormatter.ofPattern("d/M/uuuu"),
            java.time.format.DateTimeFormatter.ofPattern("dd-MM-uuuu"),
            java.time.format.DateTimeFormatter.ofPattern("d-M-uuuu"),
            java.time.format.DateTimeFormatter.ISO_LOCAL_DATE,
            java.time.format.DateTimeFormatter.ofPattern("MM/dd/uuuu"),
            java.time.format.DateTimeFormatter.ofPattern("M/d/uuuu")
    );

    private LocalDate tryParseLocalDate(String s) {
        for (var f : DATE_FORMATS) {
            try { return LocalDate.parse(s, f); }
            catch (Exception ignore) {}
        }
        return null;
    }

    // ======= MÉTODO DE CARGA DESDE EXCEL con validación SAP (firma original + overload) =======

    // Overload recomendado: devuelve también incidencias y métricas
    public Map<String, Object> cargarVentasDesdeExcel(
            InputStream inputStream,
            Map<String, Integer> mapeoColumnas,
            int filaInicio,
            String nombreArchivo) {

        long t0 = System.nanoTime();
        List<Incidencia> incidencias = new ArrayList<>();

        int filasLeidas = 0;
        int filasProcesadas = 0;

        try (Workbook workbook = WorkbookFactory.create(inputStream)) {
            Sheet hoja = workbook.getSheetAt(0);
            List<Venta> buffer = new ArrayList<>(5_000);

            for (int filaIndex = filaInicio; filaIndex <= hoja.getLastRowNum(); filaIndex++) {
                Row fila = hoja.getRow(filaIndex);
                if (fila == null) continue;
                filasLeidas++;

                String codBarra = obtenerValorCeldaComoString(fila, mapeoColumnas.get("columnaCodBarra"));
                String marca = obtenerValorCeldaComoString(fila, mapeoColumnas.get("columnaMarca"));
                String nombreProducto = obtenerValorCeldaComoString(fila, mapeoColumnas.get("columnaProducto"));
                String descripcion = obtenerValorCeldaComoString(fila, mapeoColumnas.get("columnaDescripcion"));
                String codPdv = obtenerValorCeldaComoString(fila, mapeoColumnas.get("columnaCodPdv"));
                String pdv = obtenerValorCeldaComoString(fila, mapeoColumnas.get("columnaPdv"));

                Double ventaUnidades = obtenerValorCeldaComoDouble(fila, mapeoColumnas.get("columnaUnidades"));
                Double ventaUSD = obtenerValorCeldaComoDouble(fila, mapeoColumnas.get("columnaDolares"));
                Date fecha = obtenerFechaCelda(fila, mapeoColumnas.get("columnaFecha"));

                boolean tieneVentaPositiva =
                        (ventaUnidades != null && ventaUnidades > 0) ||
                        (ventaUSD != null && ventaUSD > 0);

                if (!tieneVentaPositiva || fecha == null) continue;

                // ===== NUEVO: Validar existencia del CODBARRA en SAP antes de crear la venta =====
                if (!codBarraExisteEnSap(codBarra)) {
                    incidencias.add(new Incidencia(
                            (codBarra == null || codBarra.isBlank()) ? "CODBARRA_VACIO" : codBarra.trim(),
                            "CODBARRA no existe en SAP (CG3_360CORP.SAP_Prod).",
                            (filaIndex + 1)
                    ));
                    guardarCodigoNoEncontrado(codBarra == null ? "CODBARRA_VACIO" : codBarra.trim());
                    continue; // omitimos la fila
                }

                var zdt = fecha.toInstant().atZone(ZONE);
                Venta venta = new Venta();
                venta.setAnio(zdt.getYear());
                venta.setMes(zdt.getMonthValue());
                venta.setDia(zdt.getDayOfMonth());
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

                buffer.add(venta);
                filasProcesadas++;

                if (buffer.size() >= 10_000) {
                    guardarVentasEnBloque(buffer);
                    buffer.clear();
                }
            }
            if (!buffer.isEmpty()) {
                guardarVentasEnBloque(buffer);
            }
        } catch (Exception e) {
            incidencias.add(new Incidencia("GENERAL", "ERROR FATAL: " + e.getMessage(), -1));
        }

        long t1 = System.nanoTime();
        double segundos = (t1 - t0) / 1_000_000_000.0;

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", incidencias.stream().noneMatch(i -> i.codigo.equals("GENERAL")));
        out.put("archivo", nombreArchivo);
        out.put("filasLeidas", filasLeidas);
        out.put("filasProcesadas", filasProcesadas);
        out.put("incidencias", incidencias);
        out.put("tiempoSegundos", segundos);
        return out;
    }

    // Firma vieja (compatibilidad): retorna solo boolean; internamente llama al overload
    public boolean cargarVentasDesdeExcel(InputStream inputStream, Map<String, Integer> mapeoColumnas, int filaInicio) {
        Map<String, Object> res = cargarVentasDesdeExcel(inputStream, mapeoColumnas, filaInicio, null);
        return Boolean.TRUE.equals(res.get("ok"));
    }

    @Transactional
    public void guardarVentas(List<Venta> ventas) {
        int batchSize = 200;
        for (int i = 0; i < ventas.size(); i++) {
            guardarOActualizarVenta(ventas.get(i));
            if ((i + 1) % batchSize == 0) {
                ventaRepository.flush();
            }
        }
        ventaRepository.flush();
    }

    @Transactional
    public void guardarVentasConExecutorService(List<Venta> ventas) {
        int batchSize = 50;
        java.util.concurrent.ExecutorService executorService = java.util.concurrent.Executors.newFixedThreadPool(10);
        try {
            for (int i = 0; i < ventas.size(); i += batchSize) {
                int end = Math.min(i + batchSize, ventas.size());
                List<Venta> batchList = ventas.subList(i, end);
                executorService.submit(() -> {
                    try {
                        ventaRepository.saveAll(batchList);
                        ventaRepository.flush();
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                });
            }
        } finally {
            executorService.shutdown();
            try {
                if (!executorService.awaitTermination(60, java.util.concurrent.TimeUnit.SECONDS)) {
                    executorService.shutdownNow();
                }
            } catch (InterruptedException e) {
                executorService.shutdownNow();
            }
        }
    }

    public List<Venta> obtenerTodasLasVentas() { return ventaRepository.findAll(); }

    public Optional<Venta> obtenerVentaPorId(Long id) { return ventaRepository.findById(id); }

    public Venta actualizarVenta(Long id, Venta nuevaVenta) {
        return ventaRepository.findById(id).map(venta -> {
            venta.setAnio(nuevaVenta.getAnio());
            venta.setMes(nuevaVenta.getMes());
            venta.setDia(nuevaVenta.getDia());
            venta.setMarca(nuevaVenta.getMarca());
            venta.setVentaDolares(nuevaVenta.getVentaDolares());
            venta.setVentaUnidad(nuevaVenta.getVentaUnidad());
            venta.setNombreProducto(nuevaVenta.getNombreProducto());
            venta.setCodigoSap(nuevaVenta.getCodigoSap());
            venta.setCodBarra(nuevaVenta.getCodBarra());
            venta.setCodPdv(nuevaVenta.getCodPdv());
            venta.setDescripcion(nuevaVenta.getDescripcion());
            venta.setPdv(nuevaVenta.getPdv());
            venta.setStockDolares(nuevaVenta.getStockDolares());
            venta.setStockUnidades(nuevaVenta.getStockUnidades());
            venta.setCliente(nuevaVenta.getCliente());
            venta.setProducto(nuevaVenta.getProducto());
            return ventaRepository.save(venta);
        }).orElseThrow(() -> new RuntimeException("Venta no encontrada con el ID: " + id));
    }

    public boolean eliminarVenta(Long id) {
        return ventaRepository.findById(id).map(venta -> {
            ventaRepository.delete(venta);
            return true;
        }).orElse(false);
    }

    public boolean eliminarVentas(List<Long> ids) {
        try {
            List<Venta> ventas = ventaRepository.findAllById(ids);
            ventaRepository.deleteAll(ventas);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    public List<String> obtenerMarcasDisponibles() {
        String queryStr = "SELECT DISTINCT v.marca FROM Venta v WHERE v.marca IS NOT NULL";
        Query query = entityManager.createQuery(queryStr);
        @SuppressWarnings("unchecked")
        List<String> res = query.getResultList();
        return res;
    }

    @Transactional
    public List<Object[]> obtenerReporteVentas() {
        try {
            String sql = """
                WITH VentasMensuales AS (
                    SELECT v.cod_Pdv, v.pdv,
                           FORMAT(v.anio, '0000') + '-' + FORMAT(v.mes, '00') AS periodo,
                           SUM(CAST(v.venta_Unidad AS INT)) AS total_unidades
                    FROM [SELLOUT].[dbo].[venta] v
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
                SELECT vm.cod_Pdv, vm.pdv, tm.ciudad, tm.tipo_Display_Essence, tm.tipo_Mueble_Display_Catrice,
                       COALESCE(SUM(vm.total_unidades), 0) AS total_unidades_mes,
                       COALESCE(pu.promedio_mensual, 0) AS promedio_mes,
                       ROUND(COALESCE(pu.promedio_mensual, 0) / 30, 2) AS unidad_diaria
                FROM VentasMensuales vm
                INNER JOIN [SELLOUT].[dbo].[tipo_mueble] tm ON vm.cod_Pdv = tm.cod_Pdv
                LEFT JOIN PromedioUnidades pu ON vm.cod_Pdv = pu.cod_Pdv
                GROUP BY vm.cod_Pdv, vm.pdv, tm.ciudad, tm.tipo_Display_Essence, tm.tipo_Mueble_Display_Catrice, pu.promedio_mensual
            """;
            Query query = entityManager.createNativeQuery(sql);
            @SuppressWarnings("unchecked")
            List<Object[]> resultados = query.getResultList();
            return resultados;
        } catch (Exception e) {
            e.printStackTrace();
            return new ArrayList<>();
        }
    }

    @Transactional
    public void guardarOActualizarVenta(Venta nuevaVenta) {
        String codBarra = nuevaVenta.getCodBarra() == null ? null : nuevaVenta.getCodBarra().trim();
        String codPdv   = nuevaVenta.getCodPdv()   == null ? null : nuevaVenta.getCodPdv().trim();
        nuevaVenta.setCodBarra(codBarra);
        nuevaVenta.setCodPdv(codPdv);

        Long clienteId = (nuevaVenta.getCliente() != null) ? nuevaVenta.getCliente().getId() : null;

        Optional<Venta> existente = ventaRepository
                .findByClienteIdAndAnioAndMesAndDiaAndCodBarraAndCodPdv(
                        clienteId,
                        nuevaVenta.getAnio(),
                        nuevaVenta.getMes(),
                        nuevaVenta.getDia(),
                        nuevaVenta.getCodBarra(),
                        nuevaVenta.getCodPdv()
                );

        if (existente.isPresent()) {
            Venta v = existente.get();
            v.setVentaDolares(nuevaVenta.getVentaDolares());
            v.setVentaUnidad(nuevaVenta.getVentaUnidad());
            v.setStockDolares(nuevaVenta.getStockDolares());
            v.setStockUnidades(nuevaVenta.getStockUnidades());
            v.setPdv(nuevaVenta.getPdv());
            v.setCiudad(nuevaVenta.getCiudad());
            v.setMarca(nuevaVenta.getMarca());
            v.setNombreProducto(nuevaVenta.getNombreProducto());
            v.setCodigoSap(nuevaVenta.getCodigoSap());
            v.setDescripcion(nuevaVenta.getDescripcion());
            v.setCliente(nuevaVenta.getCliente());
            v.setProducto(nuevaVenta.getProducto());
            ventaRepository.save(v);
        } else {
            ventaRepository.save(nuevaVenta);
        }
    }

   /** Años disponibles (distintos) en Venta, opcionalmente filtrado por clienteId. */
public List<Integer> obtenerAniosDisponibles(Long clienteId) {
    String jpql = "SELECT DISTINCT v.anio FROM Venta v " +
                  (clienteId != null ? "WHERE v.cliente.id = :clienteId " : "") +
                  "ORDER BY v.anio DESC";
    TypedQuery<Integer> q = entityManager.createQuery(jpql, Integer.class);
    if (clienteId != null) q.setParameter("clienteId", clienteId);
    return q.getResultList();
}

    /** Meses disponibles (distintos) en Venta, opcionalmente filtrado por año y clienteId. */
    public List<Integer> obtenerMesesDisponibles(Integer anio, Long clienteId) {
        StringBuilder jpql = new StringBuilder("SELECT DISTINCT v.mes FROM Venta v WHERE 1=1 ");
        if (anio != null)      jpql.append("AND v.anio = :anio ");
        if (clienteId != null) jpql.append("AND v.cliente.id = :clienteId ");
        jpql.append("ORDER BY v.mes ASC");

        TypedQuery<Integer> q = entityManager.createQuery(jpql.toString(), Integer.class);
        if (anio != null)      q.setParameter("anio", anio);
        if (clienteId != null) q.setParameter("clienteId", clienteId);
        return q.getResultList();
    }
}
